// ==UserScript==
// @name CG Enhancer
// @namespace https://cgenhancer.azke.fr
// @version 0.1
// @description  Enhancer script for CodinGame platform
// @match https://www.codingame.com/*
// @copyright 2018+, Azkellas, https://github.com/Azkellas/
// @license GPL-3.0-only
// @homepage https://github.com/Azkellas/cgenhancer
// @require http://code.jquery.com/jquery-latest.js
// tamper/violent grants
// @grant GM_setValue
// @grant GM_getValue
// @grant GM_xmlhttpRequest
// grease grants
// @grant GM.setValue
// @grant GM.getValue
// @grant GM.xmlhttpRequest

// ==/UserScript==

(function()
{
    'use strict';

    // options
    const useAgentModule = true;  // set to false to disable angular debug mode (and agent panel)
    var forceExternRequest = false;  // set to true to enable fighting against bots of higher leagues

    var GMsetValue;
    var GMgetValue;
    var GMxmlhttpRequest;

    if (typeof GM_getValue !== 'undefined')
    {
        console.log('[CG Enhancer] Tamper/Violentmoneky detected');
        GMsetValue = GM_setValue;
        GMgetValue = GM_getValue;
        GMxmlhttpRequest = GM_xmlhttpRequest;
    }

    if (typeof GM !== 'undefined' && GM.xmlhttpRequest)
    {
        console.log('[CG Enhancer] Greasemoneky detected');
        GMsetValue = GM.setValue;
        GMgetValue = function(key) {return GM.getValue(key).then(function(value) { return value;});};
        GMxmlhttpRequest = GM.xmlhttpRequest;
    }

    if (!GMsetValue)
    {
        console.log('[CG Enhancer] Error: Could not detect userscript manager');
        return;
    }

    if (useAgentModule)
    {
        // required to access codingame local api
        // done first before angular has time to load
        const ngDebugStr = 'NG_ENABLE_DEBUG_INFO!';
        if (unsafeWindow.name.indexOf(ngDebugStr) === -1)
        {
            unsafeWindow.name = ngDebugStr + unsafeWindow.name;
        }
    }

    // jquery
    const $ = window.jQuery;

    // agent images
    const ideImage = document.createElement('img');
    $(ideImage).attr('class', 'selectAgentImage ideImage');
    $(ideImage).attr('src', 'https://i.imgur.com/yNpEfYt.png');
    $(ideImage).attr('style', 'cursor: pointer;');

    const arenaImage = document.createElement('img');
    $(arenaImage).attr('class', 'selectAgentImage arenaImage');
    $(arenaImage).attr('src', 'https://i.imgur.com/VkG3qnf.png');
    $(arenaImage).attr('style', 'cursor: pointer;');

    const bossImage = document.createElement('img');
    $(bossImage).attr('class', 'selectAgentImage bossImage');
    $(bossImage).attr('src', 'https://i.imgur.com/bbVA7Qv.png');
    $(bossImage).attr('style', 'cursor: pointer;');


    // Global variables ------------------------------------------------------------------------------------
    var pathName = '';  // url pathname
    var agentApi;  // local cg api used for global actions, like removing an agent or requesting the leaderboard
    var userPseudo;


    // last battles panel global variables -------------------------------------------------
    var blockTvViewer = false;  // boolean stating if the last battle tv is to be displayed or not (to prevent autostart when opening the tab)


    // agent managent global variables
    // stored for fast agent managing
    var bossAgent;
    var userAgent;

    // leaderboards
    var playersData = {};  // stores player agents through the leaderboard. keys: lowercase pseudos, values: agents
    var lastLeaderBoardUpdate; // timer used to avoid spamming leaderboards request

    // templates construction
    // I'm not sure anymore how useful they are
    const baseStyle = `cursor: auto;`;
    const rankEloBaseCss = baseStyle + `
        text-align: right;
        float: right;
        display: inline-block;
        margin-right: 30px;
    `;
    const rankPCss = rankEloBaseCss + 'font-size: 30px;';
    const eloPCss = rankEloBaseCss;
    const attrs = `contentEditable='true' spellcheck='false'`;
    const rankDivTemplate = `
        <div class='rank-div'>
            <p class='p-rank' `+attrs+` contentEditable='true' spellcheck='false' style=' {{defaultStyle}}`+ rankPCss + `'>{{value}}</p>
        </div>`;
    const eloDivTemplate  = `
        <div class='elo-div'>
            <p class='p-elo' `+attrs+` style='` + eloPCss + `{{defaultStyle}}` + `'>` + `{{value}}` + `</p>
        </div>`;
    const nameDivTemplate = `
        <div class='submission-name'>
            <p class='p-name' `+attrs+` 
                style='font-size: 18px; margin-top: 3px; float:left; display:inline-block;` + baseStyle + `{{defaultStyle}}` + `'>` +
                    `{{value}}` +
            `</p>
        </div>`;


    // rank over avatar template
    const rankAvatarCss = `
        text-font: bold;
        text-shadow: #000 1px 1px, #000 -1px 1px, #000 -1px -1px, #000 1px -1px;
        margin-left: 5px;
        font-weight: 600;
        color: white;
        position: absolute;
        bottom: 2px;
        right: 5px;
    `;


    // main function: observing all mutations
    var observer = new MutationObserver(function(mutations)
    {
        // check page name
        if ($(location).attr('pathname') !== pathName)
        {
            pathName = $(location).attr('pathname');
            console.log('[CG Enhancer] New page detected: ' + pathName);

            // reset agentApi since it's related to the current ide
            agentApi = null;
            // reset leaderboard
            lastLeaderBoardUpdate = null;
        }

        // check user pseudonyme
        const pseudoDiv = document.getElementsByClassName('navigation-profile_nav-profile-nickname')[0];
        if (!userPseudo && pseudoDiv)
        {
            userPseudo = $(pseudoDiv).attr('title');
            console.log('[CG Enhancer] User pseudonym: ' + userPseudo);
        }

        // console.log(mutations);

        // not in IDE or 'main' is not loaded
        if (document.getElementsByClassName('main').length === 0)
        {
            // remove community notifications
            const contributionNav = document.getElementById('navigation-contribute');
            if (contributionNav)
            {
                const bubbleNotif = contributionNav.getElementsByClassName('cg-notification-bubble')[0];
                if (bubbleNotif)
                {
                    bubbleNotif.remove();
                }
            }
        }

        // we are in the IDE
        else
        {
            // add swap button if not here (by cgspunk and cgenhancer)
            if ($('#cgspkSwapButton').length === 0 && $('#cgeSwapButton').length === 0)
            {
                console.log('[CG Enhancer] Add swap button');
                // code courtesy to cgspunk ( https://github.com/danBhentschel/CGSpunk/ )
                const swapButton = document.createElement('BUTTON');
                swapButton.setAttribute('id', 'cgeSwapButton');
                swapButton.innerHTML = 'SWAP';

                swapButton.style.padding = '5px 5px 5px 5px';
                const panel = document.getElementsByClassName('scroll-panel')[0];
                if (panel)
                    panel.append(swapButton);
                $('#cgeSwapButton').click(rotateAgents);
            }

            // remove swap button if cgspunk swap button here
            if ($('#cgspkSwapButton').length !== 0 && $('#cgeSwapButton').length !== 0)
            {
                console.log('[CG Enhancer] Remove swap button');
                // code courtesy to cgspunk ( https://github.com/danBhentschel/CGSpunk/ )
                const swapButton = $('#cgeSwapButton');
                swapButton.remove();
            }

            if (useAgentModule)
            {
                // resize blocs to fit fast agent selection buttons
                const agentSubmitBloc = document.getElementsByClassName('testcases-actions-container')[0];
                const codeBloc = document.getElementsByClassName('code-bloc')[0];
                const consoleBloc = document.getElementsByClassName('console-bloc')[0];
                const statementBloc = document.getElementsByClassName('statement-bloc')[0];
                if ($(codeBloc).css('bottom') !== '295px')
                    $(codeBloc).css('bottom',     '295px');
                if ($(agentSubmitBloc).css('top') === 'calc(100% - 252px)')
                    $(agentSubmitBloc).css('top',     'calc(100% - 295px)');
                // only affects the left panel if the console is not reduced and has default value
                if (document.getElementsByClassName('header-button unminimize-button').length == 0)
                {
                    if ($(consoleBloc).css('top') === 'calc(100% - 252px)')
                        $(consoleBloc).css('top',     'calc(100% - 295px)');
                    if ($(statementBloc).css('bottom') !== '295px')
                        $(statementBloc).css('bottom',     '295px');
                }
                else
                {
                    if ($(consoleBloc).css('top') !== 'calc(100% - 52px)')
                        $(consoleBloc).css('top',     'calc(100% - 52px)');
                    if ($(statementBloc).css('bottom') !== '52px')
                        $(statementBloc).css('bottom',     '52px');
                }

                const agentForApi = document.getElementsByClassName('agent')[0];
                if (agentForApi && !agentApi)
                {
                    console.log('[CG Enhancer] CG Enhancer is now working for IDEs.');
                    agentApi = unsafeWindow.angular.element(agentForApi).scope().api;
                }

                const agents = document.getElementsByClassName('agent');
                for (let agentIdx = 0; agentIdx < agents.length; agentIdx++)
                {
                    const agent = agents[agentIdx];
                    if (agent.getElementsByClassName('fastSelectButtons').length === 0)
                    {
                        console.log('[CG Enhancer] Add images');
                        $(agent).append(`<div class='fastSelectButtons'></div>`);
                        const fastDiv = agent.getElementsByClassName('fastSelectButtons')[0];
                        $(ideImage).clone().appendTo(fastDiv);
                        $(fastDiv.getElementsByClassName('ideImage')[0]).click(function() {
                            addAgent(agentIdx, 'ide');
                        });
                        $(arenaImage).clone().appendTo(fastDiv);
                        $(fastDiv.getElementsByClassName('arenaImage')[0]).click(function() {
                            addAgent(agentIdx, 'arena');
                        });
                        $(bossImage).clone().appendTo(fastDiv);
                        $(fastDiv.getElementsByClassName('bossImage')[0]).click(function() {
                            addAgent(agentIdx, 'boss');
                        });

                        console.log('[CG Enhancer] Add fast input');
                        $(agent).append(`<div class='fastInput'></div>`);
                        const inputDiv = agent.getElementsByClassName('fastInput')[0];
                        $(inputDiv).append(`<input class='fastAgentInput' type='text' />`);
                        const inputBox = inputDiv.getElementsByClassName('fastAgentInput')[0];
                        $(inputBox).keyup({'index': agentIdx}, addFastPlayer);

                        $(inputBox).css('width', '80px');
                        $(inputBox).css('height', '20px');
                        $(inputBox).css('padding-left', '5px');
                        $(inputBox).css('background-color', '#777');
                        $(inputBox).css('color', '#fff');
                        $(inputBox).css('margin-bottom', '0px');

                        updatePlayersData();
                    }
                }
            }
            // console.log(mutations);
            // check if we opened last battles without looking at all mutations
            if ($(mutations[0].target).attr('class') && $(mutations[0].target).attr('class').indexOf('cg-ide-last-battles') !== -1)
            {
                console.log('[CG Enhancer] Opened last battles');
                blockTvViewer = true;
                updatePlayersData();
            }

            // hide battle tv on last battles tab opening
            for (const battleTv of document.getElementsByClassName('battle-tv'))
            {
                // hide
                if (blockTvViewer)
                    $(battleTv).attr('class', 'battle-tv-hidden');
                // reveal if clicked
                $(battleTv).click(function() {
                    blockTvViewer = false;
                    $(this).attr('class', 'battle-tv');
                });
            }

            // add ranks on last battle tabs
            for (const battleDiv of document.getElementsByClassName('battle battle-done'))
            {
                const color = getColor(battleDiv);
                if ($(battleDiv).css('background-color') !== color)
                    $(battleDiv).css('background-color',     color);

                for (const playerAvatar of battleDiv.getElementsByClassName('player-agent'))
                {
                    const player = $(playerAvatar).attr('title');
                    if (player && player !== userPseudo && playersData[player.toLowerCase()])
                    {
                        if (playerAvatar.getElementsByClassName('player-rank-cgen').length === 0)
                        {
                            const rankDiv =
                                `<div class='player-rank-cgen' style='` + rankAvatarCss + `'>` +
                                    playersData[player.toLowerCase()].localRank +
                                `</div>`;
                            $(playerAvatar).append(rankDiv);
                        }
                    }
                }
            }

            for (const battleTv of document.getElementsByClassName('battle-tv-hidden'))
            {
                for (const showButton of battleTv.getElementsByClassName('battle-button-label'))
                {
                    if ($(showButton).text() === 'Close')
                        $(showButton).trigger('click');
                }

            }
            // if the submission panel is open
            for (const submission of document.getElementsByClassName('submission-card'))
            {
                // add flex style
                if ($(submission).css('display') !== 'flex')
                {
                    $(submission).css('display', 'flex');
                    $(submission).css('flex-direction', 'column');
                    $(submission).css('flex-wrap', 'wrap');
                }

                // date is required for storageHash, hence computed here
                const date = submission.getElementsByClassName('date')[0];

                // create left side div (date + name)
                if (submission.getElementsByClassName('date-name-div').length === 0)
                {
                    $(submission)
                        .children().not(submission.getElementsByClassName('icon-arrow ide-icon_arrow_black'))
                        .wrapAll( '<div class="date-name-div" />');
                    const bundler = submission.getElementsByClassName('date-name-div')[0];
                    $(bundler).css('float', 'left');
                    $(bundler).css('width', '150px');
                    $(bundler).css('display', 'flex');
                    $(bundler).css('flex-direction', 'inherit');
                }

                // create right side div (rank + elo)
                if (submission.getElementsByClassName('rank-elo-div').length === 0)
                {
                    $(submission).append(`<div class='rank-elo-div'></div>`);
                    const bundler = submission.getElementsByClassName('rank-elo-div')[0];
                    $(bundler).css('width', '100px');
                    $(bundler).css('align-self', 'flex-end');
                    $(bundler).css('display', 'inline-block');
                }

                // modify data display for an exact date
                if (date && $(date).text() !== $(date).attr('title'))
                {
                    $(date).text($(date).attr('title'));
                    $(date).css('font-size', '12px');
                }

                // add name storage
                if (submission.getElementsByClassName('submission-name').length === 0)
                {
                    const bundler = submission.getElementsByClassName('date-name-div')[0];
                    const storageHash = pathName + $(date).attr('title') + 'name';
                    const div = getDiv({'storageHash': storageHash, 'default': 'unnamed', 'defaultStyle': 'color: #cccccc;'}, nameDivTemplate);
                    $(bundler).append(div);
                    const pNode = bundler.getElementsByClassName('p-name')[0];
                    $(pNode).click(clickEvent);
                    $(pNode).keypress({'type': 'name', 'default': 'unnamed','storageHash': storageHash}, keyPressEvent);
                }

                // add rank storage
                if (submission.getElementsByClassName('rank-div').length === 0)
                {
                    const bundler = submission.getElementsByClassName('rank-elo-div')[0];
                    const storageHash = pathName + $(date).attr('title') + 'rank';
                    const div = getDiv({'storageHash': storageHash, 'default': '#XX', 'defaultStyle': 'color: #cccccc;'}, rankDivTemplate);
                    $(bundler).append(div);
                    const pNode = bundler.getElementsByClassName('p-rank')[0];
                    $(pNode).click(clickEvent);
                    $(pNode).keypress({'type': 'rank', 'default': '#XX','storageHash': storageHash}, keyPressEvent);
                }

                // add elo storage
                if (submission.getElementsByClassName('elo-div').length === 0)
                {
                    const bundler = submission.getElementsByClassName('rank-elo-div')[0];
                    const storageHash = pathName + $(date).attr('title') + 'elo';
                    const div = getDiv({'storageHash': storageHash, 'default': '12.34', 'defaultStyle': 'color: #cccccc;'}, eloDivTemplate);
                    $(bundler).append(div);
                    const pNode = bundler.getElementsByClassName('p-elo')[0];
                    $(pNode).click(clickEvent);
                    $(pNode).keypress({'type': 'elo', 'default': '12.34','storageHash': storageHash}, keyPressEvent);
                }
            }
        }
    });


    var waitingForDocument = setInterval(function(){
        // configuration of the observer:
        var config = { attributes: true, childList: true, characterData: true, subtree: true};

        // disallow sound for notifications
        if (unsafeWindow.session.notificationConfig.soundEnabled)
            unsafeWindow.session.notificationConfig.soundEnabled = false;

        // notifications
        // 'clash-invite', 'clash-over', 'invitation-accepted'
        // 'contest-scheduled', 'contest-started', 'contest-over', 'contest-soon'
        // 'new-league', 'new-league-opened', 'new-blog', 'new-comment', 'new-comment-response', 'new-puzzle', 'new-hint', 'new-level'
        // 'contribution-received', 'contribution-accepted', 'contribution-refused'
        // 'following', 'friend-registered'
        // 'achievement-unlocked'
        // 'promoted-league', 'eligible-for-next-league'
        // 'puzzle-of-the-week'
        // 'career-new-candidate', 'career-update-candidate'
        // 'feature', 'custom'
        const notifToRemove = ['clash-invite', 'following'];
        for (const notif of notifToRemove)
        {
            const idx = unsafeWindow.session.enabledNotifications.indexOf(notif);
            if (idx !== -1)
                unsafeWindow.session.enabledNotifications.splice(idx, 1);
        }

        console.log('[CG Enhancer] CG Enhancer is now working.');
        observer.observe(document, config);
        clearInterval(waitingForDocument);
    }, 1000);


    // helpers
    /**
     * @param {int} index - index of agent to remove
     */
    function removeAgent(index)
    {
        agentApi.removeAgent(index);
        let agent = document.getElementsByClassName('agent')[index];
        agent = unsafeWindow.angular.element(agent);
        agent.scope().$apply();
    }

    /**
     * @param {int} index - index of agent to add
     * @param {string} type - type or pseudo of agent to add
     */
    function addAgent(index, type)
    {
        removeAgent(index);
        let agent = document.getElementsByClassName('agent')[index];
        agent = unsafeWindow.angular.element(agent);

        if (type === 'ide')
            agent.scope().api.addAgent({'agentId': -1});
        if (type === 'arena')
        {
            if (userAgent)
                agent.scope().api.addAgent(userAgent);
            else
                type = 'boss'; // the player did not submit any AI yet
        }
        if (type === 'boss')
        {
            if (bossAgent)
                agent.scope().api.addAgent(bossAgent);
            else  // could not find the boss (the player is in legned league)
                agent.scope().api.addAgent({'agentId': -2});  // -2 is the defaultAI agentId
        }
        if (type !== 'ide' && type !== 'arena' && type !== 'boss')  // type is a real player, not the best way to code it
        {
            agent.scope().api.addAgent(playersData[type]);
        }

        agent = document.getElementsByClassName('agent')[index];
        agent = unsafeWindow.angular.element(agent);
        agent.scope().$apply();
    }

    /**
     * rotate agents
     */
    function rotateAgents()
    {
        // code partly courtesy to cgspunk ( https://github.com/danBhentschel/CGSpunk/ )
        console.log('[CG Enhancer] Rotating agents');
        const agents = [];
        // get agents
        for (let agent of document.getElementsByClassName('agent'))
        {
            agent = unsafeWindow.angular.element(agent);
            if (agent.scope().$parent.agent !== null) // check if there is indeed an agent or if the agent is empty
                agents.push(agent.scope().$parent.agent);
        }
        // shift agents
        agents.push(agents.shift());

        // add agents
        for (let index = 0; index < agents.length; index++) {
            removeAgent(index);
            let agent = document.getElementsByClassName('agent')[index];
            agent = unsafeWindow.angular.element(agent);
            agent.scope().api.addAgent(agents[index]);
            agent = document.getElementsByClassName('agent')[index];
            agent = unsafeWindow.angular.element(agent);
            agent.scope().$apply();
        }
    }

    /**
     * use templates to create the div required
     * @param {object} data - contains all options required to generate the div
     * @param {string} template - html template to use
     */
    function getDiv(data, template)
    {
        // data: {storageHash, default, defaultStyle}
        const name = GMgetValue(data.storageHash, data.default);
        let style = '';
        if (name === data.default)
            style = data.defaultStyle;
        template = template.replace('{{value}}', name);
        template = template.replace('{{defaultStyle}}', style);
        return template;
    }

    /**
     * return the color highlight of the battle in the last battle tabs
     * difference to determine if the result is unexpected is
     * enemyRank > 1.2*userRank + 10  (randomly chosen)
     * note: this function does not check for draws, but check wins by looking at which player is displayed first
     * @param {jquery object} battleDiv
     */
    function getColor(battleDiv)
    {
        // if more than 2 players, not coloration
        if (battleDiv.getElementsByClassName('player-agent').length > 2)
            return '#fff';

        // userAgent undefined
        if (!userAgent)
            return '#fff';

        let userRank;
        let enemyRank;
        let userWon;

        const players = battleDiv.getElementsByClassName('player-agent');
        for (let playerIdx = 0; playerIdx < players.length; playerIdx++)
        {
            const playerAvatar = players[playerIdx];

            const player = $(playerAvatar).attr('title');
            if (player && playersData[player.toLowerCase()] && player !== userPseudo)
                enemyRank = playersData[player.toLowerCase()].localRank;
            if (player && player === userPseudo)
            {
                userRank = userAgent.localRank;
                userWon = (playerIdx === 0);
            }
        }

        // at least one undefined rank
        if (!userRank || !enemyRank || !userWon)
            return '#eee';

        // unexpected loss
        if (enemyRank > 1.2*userRank + 10 && !userWon)
            return '#fee';

        // unexepcted win
        if (userRank > 1.2*enemyRank + 10 && userWon)
            return '#efe';

        // expected result
        return '#fff';
    }

    /**
     * stop propagation
     * @param {DOM event} event
     */
    function clickEvent(event)
    {
        if (!this)
        {
            console.log('[CG Enhancer] Error: clickEvent must be called inside a click method.');
            return;
        }
        // prevent codingame action
        event.stopPropagation();
    }

    /**
     * poorly named function
     * it is called when the user tries to select an agent by its pseudo
     * @param {DOM event} event
     */
    function addFastPlayer(event)
    {
        if (!this)
        {
            console.log('[CG Enhancer] Error: addFastPlayer must be called inside a keyup method.');
            return;
        }

        const key = event.which;
        if (key === 13)  // enter key
        {
            const pseudo = $(this).val();

            // add existing player
            if (pseudo && playersData[pseudo.toLowerCase()])
            {
                console.log('[CG Enhancer] Player ' + pseudo + ' found');
                addAgent(event.data.index, pseudo.toLowerCase());
                $(this).text('');  // reset pseudo
                $(this).css('color', '#fff');  // reset color
                $(this).blur();  // focus out
            }
            // player not found
            else
            {
                console.log('[CG Enhancer] Player ' + pseudo + ' could not be found');
                $(this).css('color', '#faa');  // red coloration if player not found
            }

            // prevent codingame action
            event.stopPropagation();
        }
        else
        {
            // reset color to white
            $(this).css('color', '#fff');
        }
    }

    /**
     * called in the history tab
     * @param {DOM event} event - contains data
     */
    function keyPressEvent(event)
    {
        // event.data :
        //    {
        //      type
        //      defaultValue
        //      storageHash
        //    }

        if (this)
        {
            console.log('[CG Enhancer] Error: keyPressEvent must be called inside a keypress method.');
            return;
        }

        const key = event.which;
        if (key === 13)  // enter key
        {
            // lose focus
            $(this).blur();  // lose focus

            // make sure no empty value is stored
            if ($(this).text() === '')
                $(this).text(event.data.default);

            // save value (even if default to erase previous value)
            GMsetValue(event.data.storageHash, $(this).text());

            // apply coloration
            if ($(this).text() !== event.data.default)
                $(this).css('color', '');
            else
                $(this).css('color', '#cccccc');

            // prevent codingame action
            event.stopPropagation();
        }
    }

    /**
     * update playersData to store agentId and ranks
     */
    function updatePlayersData()
    {
        // angular is not activated
        if (useAgentModule === false)
            forceExternRequest = true;
        // make sure we do not update every 5 sec
        // at most once every minute
        if (lastLeaderBoardUpdate && (new Date() - lastLeaderBoardUpdate < 60*1000))
            return;

        // reset stored leaderboard and user/boss agents
        lastLeaderBoardUpdate = new Date();
        playersData = {};
        userAgent;
        bossAgent;

        // we get the leaderboard through the API
        if (!forceExternRequest && agentApi)
        {
            console.log('[CG Enhancer] Requesting the leaderboard through agentApi');

            agentApi.getLeaderboard()
                .then(function(result) {
                    // direct access to user agent
                    userAgent = result.codingamerUserRank;

                    for (const user of result.users)
                    {
                        if (user.pseudo)
                        {
                            playersData[user.pseudo.toLowerCase()] = user;
                            if (user.arenaboss && (!userAgent || userAgent.league.divisionIndex === user.league.divisionIndex))
                                bossAgent = user;
                        }
                    }
                })
                .catch(function(error) {
                    console.log(error);
                });

        }
        // we make an extern api request since we don't have the agentAPI
        else
        {
            console.log('[CG Enhancer] Requesting the leaderboard through an extern request');
            const gameSplit = pathName.split('/');
            const multi = gameSplit.slice(-1)[0];
            let api = '';
            if (gameSplit.slice(-2)[0] === 'puzzle')
                api = 'getFilteredPuzzleLeaderboard';
            else
                api = 'getFilteredChallengeLeaderboard';
            GMxmlhttpRequest({
                url: 'https://www.codingame.com/services/LeaderboardsRemoteService/' + api,
                method: 'POST',
                responseType: 'json',
                data: '[' + multi + ', undefined, global, { active: false, column: undefined, filter: undefined}]',
                onload: function(response) {
                    const rawLeaderboard = response.response.success;
                    const users = rawLeaderboard.users;
                    for (const user of users)
                    {
                        if (user.pseudo)
                        {
                            playersData[user.pseudo.toLowerCase()] = user;
                            playersData[user.pseudo.toLowerCase()].rank = user.localRank;  // to avoid wrong rank in agent panel when selected
                            if (user.pseudo === userPseudo)
                                userAgent = user;
                        }
                    }
                }
            });
        }
    }
})();
