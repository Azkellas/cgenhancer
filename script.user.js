    // ==UserScript==
// @name CG Enhancer
// @namespace https://cgenhancer.azke.fr
// @version 0.1
// @description  Enhancer script for CodinGame platform
// @match https://www.codingame.com/*
// @license 2018+, MIT
// @require http://code.jquery.com/jquery-latest.js
// @require https://cdnjs.cloudflare.com/ajax/libs/then-request/2.2.0/request.min.js
// @require https://cdnjs.cloudflare.com/ajax/libs/selectize.js/0.12.6/js/standalone/selectize.min.js
// @require https://cdnjs.cloudflare.com/ajax/libs/select2/4.0.6-rc.0/js/select2.min.js
// @grant GM_setValue
// @grant GM_getValue
// @grant GM_xmlhttpRequest
// ==/UserScript==

// @require https://cdnjs.cloudflare.com/ajax/libs/angular.js/1.7.2/angular.js

(function() {
    'use strict';

    // required to access codingame local api
    // done first before angular has time to load
    let ngDebugStr = 'NG_ENABLE_DEBUG_INFO!';
    if (unsafeWindow.name.indexOf(ngDebugStr) === -1) {
        unsafeWindow.name = ngDebugStr + unsafeWindow.name;
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
    var pathName = "";  // url pathname
    var agentApi = undefined;  // local cg api used for global actions, like removing an agent or requesting the leaderboard
    var userPseudo = undefined;


    // last battles panel global variables -------------------------------------------------
    var blockTvViewer = false;  // boolean stating if the last battle tv is to be displayed or not (to prevent autostart when opening the tab) 


    // agent managent global variables
    // stored for fast agent managing
    var bossAgent = undefined;
    var userAgent = undefined;

    // leaderboards
    var playersData = {};  // stores player agents through the leaderboard. keys: lowercase pseudos, values: agents
    var lastLeaderBoardUpdate = undefined; // timer used to avoid spamming leaderboards request

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
            <p class='p-name' `+attrs+` style='font-size: 18px; margin-top: 3px; float:left; display:inline-block;` + baseStyle + `{{defaultStyle}}` + `'>` + `{{value}}` + `</p>
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
    var observer = new MutationObserver(function(mutations) {
        // check page name
        if ($(location).attr('pathname') !== pathName)
        {
            pathName = $(location).attr('pathname');
            console.log('new page: ' + pathName);
            
            // reset agentApi since it's related to the current ide
            agentApi = undefined;
            // reset leaderboard
            lastLeaderBoardUpdate = undefined;
        }

        // check user pseudonyme
        var pseudoDiv = document.getElementsByClassName("navigation-profile_nav-profile-nickname")[0];
        if (userPseudo === undefined && pseudoDiv)
        {
            userPseudo = $(pseudoDiv).attr('title');
            console.log("User pseudonym: " + userPseudo);
        }

        // console.log(mutations);

        // not in IDE or "main" is not loaded
        if (document.getElementsByClassName("main").length === 0)
        {
            // remove community notifications 
            var contributionNav = document.getElementById("navigation-contribute");
            if (contributionNav)
            {
                var bubbleNotif = contributionNav.getElementsByClassName("cg-notification-bubble")[0];
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
                console.log('Add swap button');
                // code courtesy to cgspunk ( https://github.com/danBhentschel/CGSpunk/ )
                let swapButton = document.createElement('BUTTON');
                swapButton.setAttribute('id', 'cgeSwapButton');
                swapButton.innerHTML = 'SWAP';

                swapButton.style.padding = '5px 5px 5px 5px';
                let panel = document.getElementsByClassName('scroll-panel')[0];
                if (panel)
                    panel.append(swapButton);
        
                $('#cgeSwapButton').click(rotateAgents);
            }

            // resize blocs to fit fast agent selection buttons
            let agentSubmitBloc = document.getElementsByClassName("testcases-actions-container")[0];
            let codeBloc = document.getElementsByClassName("code-bloc")[0];
            let consoleBloc = document.getElementsByClassName("console-bloc")[0];
            let statementBloc = document.getElementsByClassName("statement-bloc")[0];
            if ($(codeBloc).css('bottom') !== '295px')
                $(codeBloc).css('bottom',     '295px');
            if ($(agentSubmitBloc).css('top') === 'calc(100% - 252px)');
                $(agentSubmitBloc).css('top',     'calc(100% - 295px)');
            // only affects the left panel if the console is not reduced and has default value
            if (document.getElementsByClassName('header-button unminimize-button').length == 0)
            {
                if ($(consoleBloc).css('top') === 'calc(100% - 252px)');
                    $(consoleBloc).css('top',     'calc(100% - 295px)');   
                if ($(statementBloc).css('bottom') !== '295px')
                    $(statementBloc).css('bottom',     '295px');
            }
            else
            {
                if ($(consoleBloc).css('top') !== 'calc(100% - 52px)');
                    $(consoleBloc).css('top',     'calc(100% - 52px)');   
                if ($(statementBloc).css('bottom') !== '52px')
                    $(statementBloc).css('bottom',     '52px');
            }
            let agentForApi = document.getElementsByClassName("agent")[0];
            if (agentForApi && agentApi === undefined)
            {
                console.log('CG Enhancer is now working for IDEs.');
                agentApi = unsafeWindow.angular.element(agentForApi).scope().api;
            }


            let agents = document.getElementsByClassName("agent");
            for (let agentIdx = 0; agentIdx < agents.length; agentIdx++) { 
                let agent = agents[agentIdx];
                if (agent.getElementsByClassName('card').length !== 0 && agent.getElementsByClassName('fastSelectButtons').length === 0)
                {
                    console.log('add images');
                    $(agent).append(`<div class="fastSelectButtons"></div>`);
                    let fastDiv = agent.getElementsByClassName('fastSelectButtons')[0];
                    console.log(fastDiv);
                    $(ideImage).clone().appendTo(fastDiv);
                    $(fastDiv.getElementsByClassName('ideImage')[0]).click(function(event) {
                        addAgent(agentIdx, 'ide');
                    })
                    $(arenaImage).clone().appendTo(fastDiv);
                    $(fastDiv.getElementsByClassName('arenaImage')[0]).click(function(event) {
                        addAgent(agentIdx, 'arena');
                    })
                    $(bossImage).clone().appendTo(fastDiv);
                    $(fastDiv.getElementsByClassName('bossImage')[0]).click(function(event) {
                        addAgent(agentIdx, 'boss');
                    })

                    console.log('add fast input');
                    $(agent).append(`<div class="fastInput"></div>`);
                    let inputDiv = agent.getElementsByClassName('fastInput')[0];
                    $(inputDiv).append(`<input class="fastAgentInput" type="text" />`);
                    let inputBox = inputDiv.getElementsByClassName('fastAgentInput')[0];
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
        

            // check if we opened last battles without looking at all mutations
            if ($(mutations[0].target).attr('class') === "cg-ide-last-battles ng-scope ng-isolate-scope")
            {
                console.log('opened last battles');
                blockTvViewer = true;
                updatePlayersData();
            }

            // hide battle tv on last battles tab opening            
            for (var battleTv of document.getElementsByClassName("battle-tv"))
            {
                // hide
                if (blockTvViewer)
                    $(battleTv).attr('class', 'battle-tv-hidden');
                // reveal if clicked
                $(battleTv).click(function(event) {
                    blockTvViewer = false;
                    $(this).attr('class', 'battle-tv');
                });
            }

            // add ranks on last battle tabs
            for (var battleDiv of document.getElementsByClassName('battle battle-done'))
            {
                let color = getColor(battleDiv);
                if ($(battleDiv).css('background-color') !== color)
                    $(battleDiv).css('background-color',     color);

                for (var playerAvatar of battleDiv.getElementsByClassName('player-agent'))
                {
                    let player = $(playerAvatar).attr('title');
                    if (player && player !== userPseudo && playersData[player.toLowerCase()])
                    {
                        if (playerAvatar.getElementsByClassName('player-rank-cgen').length === 0)
                            $(playerAvatar).append(`<div class='player-rank-cgen' style='` + rankAvatarCss + `'>` + playersData[player.toLowerCase()].localRank + `</div>`);
                    }
                }
            }

            for (battleTv of document.getElementsByClassName("battle-tv-hidden"))
            {
                for (var showButton of document.getElementsByClassName("battle-button-label"))
                {
                    if ($(showButton).text() === 'Close')
                        $(showButton).trigger('click');
                }
    
            }
            // if the submission panel is open
            for (var submission of document.getElementsByClassName("submission-card"))
            {
                // add flex style
                if ($(submission).css('display') !== 'flex')
                {    
                    $(submission).css('display', 'flex');
                    $(submission).css('flex-direction', 'column');
                    $(submission).css('flex-wrap', 'wrap');
                }

                // date is required for storageHash, hence computed here
                var date = submission.getElementsByClassName('date')[0]; 

                // create left side div (date + name)
                if (submission.getElementsByClassName('date-name-div').length === 0)
                {
                    $(submission).children().not(submission.getElementsByClassName('icon-arrow ide-icon_arrow_black')).wrapAll( "<div class='date-name-div' />");
                    let bundler = submission.getElementsByClassName('date-name-div')[0];
                    $(bundler).css('float', 'left');
                    $(bundler).css('width', '150px');
                    $(bundler).css('display', 'flex');
                    $(bundler).css('flex-direction', 'inherit');
                }

                // create right side div (rank + elo)
                if (submission.getElementsByClassName('rank-elo-div').length === 0)
                {
                    $(submission).append(`<div class='rank-elo-div'></div>`);
                    let bundler = submission.getElementsByClassName('rank-elo-div')[0];
                    $(bundler).css('width', '100px');
                    $(bundler).css('align-self', 'flex-end');
                    $(bundler).css('display', 'inline-block');
                    
                }

                // modify data display for an exact date
                if (date && $(date).text() !== $(date).attr('title'))
                {
                    $(date).text($(date).attr('title'));
                    $(date).css("font-size", "12px");
                }
                
                // add name storage
                if (submission.getElementsByClassName('submission-name').length === 0)
                {
                    let bundler = submission.getElementsByClassName('date-name-div')[0];
                    let storageHash = pathName + $(date).attr('title') + 'name';
                    let div = getDiv({'storageHash': storageHash, 'default': 'unnamed', 'defaultStyle': 'color: #cccccc;'}, nameDivTemplate);
                    $(bundler).append(div);
                    let pNode = bundler.getElementsByClassName('p-name')[0];
                    $(pNode).click(clickEvent);
                    $(pNode).keypress({'type': 'name', 'default': 'unnamed','storageHash': storageHash}, keyPressEvent);
                }

                // add rank storage
                if (submission.getElementsByClassName('rank-div').length === 0)
                {
                    let bundler = submission.getElementsByClassName('rank-elo-div')[0];
                    let storageHash = pathName + $(date).attr('title') + 'rank';
                    let div = getDiv({'storageHash': storageHash, 'default': '#XX', 'defaultStyle': 'color: #cccccc;'}, rankDivTemplate);
                    $(bundler).append(div);
                    let pNode = bundler.getElementsByClassName('p-rank')[0];
                    $(pNode).click(clickEvent);
                    $(pNode).keypress({'type': 'rank', 'default': '#XX','storageHash': storageHash}, keyPressEvent);
                }

                // add elo storage
                if (submission.getElementsByClassName('elo-div').length === 0)
                {
                    let bundler = submission.getElementsByClassName('rank-elo-div')[0];
                    let storageHash = pathName + $(date).attr('title') + 'elo';
                    let div = getDiv({'storageHash': storageHash, 'default': '12.34', 'defaultStyle': 'color: #cccccc;'}, eloDivTemplate);
                    $(bundler).append(div);
                    let pNode = bundler.getElementsByClassName('p-elo')[0];
                    $(pNode).click(clickEvent);
                    $(pNode).keypress({'type': 'elo', 'default': '12.34','storageHash': storageHash}, keyPressEvent);
                }
            }
        }
    });


    var waitingForDocument = setInterval(function(){
        // configuration of the observer:
        var config = { attributes: true, childList: true, characterData: true, subtree: true}


        // disallow sound for notifications
        if (unsafeWindow.session.notificationConfig.soundEnabled)
            unsafeWindow.session.notificationConfig.soundEnabled = false;
        
        // notifications
        // ["clash-invite", "contest-scheduled", "contest-started", "contest-over", "clash-over", "following", "new-puzzle", "friend-registered", "invitation-accepted", "new-comment", "new-comment-response", "achievement-unlocked", "new-hint", "promoted-league", "contest-soon", "puzzle-of-the-week", "eligible-for-next-league", "new-league", "new-league-opened", "feature", "new-level", "career-new-candidate", "career-update-candidate", "custom", "new-blog", "contribution-received", "contribution-accepted", "contribution-refused"]
        let notifToRemove = ["clash-invite", "following"];
        for (let notif of notifToRemove)
        {
            let idx = unsafeWindow.session.enabledNotifications.indexOf(notif);
            if (idx !== -1)
                unsafeWindow.session.enabledNotifications.splice(idx, 1);
        }

        console.log('CG Enhancer is now working.');
        observer.observe(document, config);
        clearInterval(waitingForDocument);
    }, 1000);


    // helpers
    function removeAgent(index)
    {
        agentApi.removeAgent(index);
        let agent = document.getElementsByClassName('agent')[index];
        agent = unsafeWindow.angular.element(agent);
        agent.scope().$apply();
    }

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

    function rotateAgents()
    {
        // code partly courtesy to cgspunk ( https://github.com/danBhentschel/CGSpunk/ )
        console.log('rotating agents');
        let agents = [];
        // get agents
        for (let agent of document.getElementsByClassName("agent"))
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


    // use templates to create the div required
    function getDiv(data, template)
    {
        // data: {storageHash, default, defaultStyle}
        let name = GM_getValue(data.storageHash, data.default);
        let style = '';
        if (name === data.default)
            style = data.defaultStyle;
        template = template.replace('{{value}}', name);
        template = template.replace('{{defaultStyle}}', style);
        return template;
    }

    // return the color highlight of the battle in the last battle tabs
    // difference to determine if the result is unexpected is
    // enemyRank > 1.2*userRank + 10  (randomly chosen)
    // note: this function does not check for draws, but check wins by looking at which player is displayed first
    function getColor(battleDiv)
    {
        // if more than 2 players, not coloration
        if (battleDiv.getElementsByClassName('player-agent').length > 2)
            return '#fff';

        let userRank = undefined;
        let enemyRank = undefined;
        let userWon = undefined;

        let players = battleDiv.getElementsByClassName("player-agent");
        for (let playerIdx = 0; playerIdx < players.length; playerIdx++)
        { 
            let playerAvatar = players[playerIdx];

            let player = $(playerAvatar).attr('title');
            if (player && playersData[player.toLowerCase()] && player !== userPseudo)
                enemyRank = playersData[player.toLowerCase()].localRank;
            if (player && player === userPseudo)
            {
                userRank = userAgent.localRank;
                userWon = (playerIdx === 0);
            }
        }

        // at least one undefined rank
        if (userRank === undefined || enemyRank === undefined || userWon === undefined)
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

    // stop propagation
    function clickEvent(event)
    {
        // event.data :
        //    { 
        //      type
        //      defaultValue
        //      storageHash
        //    }

        if (this === undefined)
        {
            console.log('Error: clickEvent must be called inside a click method.');
            return;
        }

        // prevent codingame action
        event.stopPropagation();
    }

    // poorly named function
    // it is called when the user tries to select an agent by its pseudo
    function addFastPlayer(event)
    {
        if (this === undefined)
        {
            console.log('Error: addFastPlayer must be called inside a keyup method.');
            return;
        }

        var key = event.which;
        if (key === 13)  // enter key
        {
            let pseudo = $(this).val();
            
            // add existing player
            if (playersData[pseudo.toLowerCase()])
            {
                console.log('player ' + pseudo + ' found');
                addAgent(event.data.index, pseudo.toLowerCase());
                $(this).text('');  // reset pseudo
                $(this).css('color', '#fff');  // reset color
                $(this).blur();  // focus out
            }
            // player not found
            else
            {
                console.log('player ' + pseudo + ' could not be found');
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

    // called in the history tab
    function keyPressEvent(event)
    {
        // event.data :
        //    { 
        //      type
        //      defaultValue
        //      storageHash
        //    }

        if (this === undefined)
        {
            console.log('Error: keyPressEvent must be called inside a keypress method.');
            return;
        }

        var key = event.which;
        if (key === 13)  // enter key
        {
            // lose focus
            $(this).blur();  // lose focus

            // make sure no empty value is stored
            if ($(this).text() === '')
                $(this).text(event.data.default);

            // save value (even if default to erase previous value)
            GM_setValue(event.data.storageHash, $(this).text());

            // apply coloration
            if ($(this).text() !== event.data.default)
                $(this).css("color", "");
            else
                $(this).css("color", "#cccccc");

            // prevent codingame action
            event.stopPropagation();
        }
    }

    // update playersData to store agentId and ranks
    function updatePlayersData()
    {
        // make sure we do not update every 5 sec
        // at most once every minute
        if (lastLeaderBoardUpdate && (new Date() - lastLeaderBoardUpdate < 60*1000))
            return;

        // reset stored leaderboard and user/boss agents
        lastLeaderBoardUpdate = new Date();
        playersData = {};
        userAgent = undefined;
        bossAgent = undefined;

        // we get the leaderboard through the API
        if (agentApi)
        {
            console.log("Requesting the leaderboard through agentApi");

            agentApi.getLeaderboard().then(function(result) {
                // direct access to user agent
                userAgent = result.codingamerUserRank;

                for (let user of result.users)
                {
                    playersData[user.pseudo.toLowerCase()] = user;
                    if (user.arenaboss && (userAgent === undefined || userAgent.league.divisionIndex === user.league.divisionIndex))
                        bossAgent = user;
                }
            })
            .catch(function(error) {
                console.log(error);
            });

        }
        // we make an extern api request since we don't have the agentAPI
        else
        {
            console.log("Requesting the leaderboard through an extern request");
            let gameSplit = pathName.split('/');
            let multi = gameSplit.slice(-1)[0];
            let api = '';
            if (gameSplit.slice(-2)[0] === 'puzzle')
                api = 'getFilteredPuzzleLeaderboard';
            else
                api = 'getFilteredChallengeLeaderboard';
            GM_xmlhttpRequest({
                url : 'https://www.codingame.com/services/LeaderboardsRemoteService/' + api,
                method : 'POST',
                responseType : 'json',
                data : '[' + multi + ", undefined, global, { active: false, column: undefined, filter: undefined}]",
                onload: function(response) {
                    let rawLeaderboard = response.response.success;
                    let users = rawLeaderboard.users;
                    for (let user of users)
                    {
                        playersData[user.pseudo.toLowerCase()] = user;
                    }
                }
            });
        }
    }
})();
