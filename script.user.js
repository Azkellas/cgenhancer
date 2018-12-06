// ==UserScript==
// @name CG Enhancer
// @namespace https://cgenhancer.azke.fr
// @version 0.2.1
// @description  Enhancer script for CodinGame platform
// @match https://www.codingame.com/*
// @copyright 2018+, Azkellas, https://github.com/Azkellas/
// @license GPL-3.0-only
// @homepage https://github.com/Azkellas/cgenhancer
// @require http://code.jquery.com/jquery-latest.js
// @grant unsafeWindow
// @grant GM_setValue
// @grant GM_getValue
// @grant GM_xmlhttpRequest
// ==/UserScript==


(function()
{
    'use strict';
    /* global GM_setValue, GM_getValue, GM_xmlhttpRequest, unsafeWindow */

    // options
    var useAgentModule = true;  // set to false to disable angular debug mode (and agent panel)
    var forceExternRequest = false;  // set to true to enable fighting against bots of higher leagues

    // existing notifications:
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
    const enableSound = false;
    const notifToRemove = ['clash-invite', 'following'];

    var GMsetValue;
    var GMgetValue;
    var GMxmlhttpRequest;

    var lastCodeBlocUpdate;

    if (typeof GM_getValue !== 'undefined')
    {
        console.log('[CG Enhancer] Tamper/Violentmoneky detected');
        GMsetValue = GM_setValue;
        GMgetValue = GM_getValue;
        GMxmlhttpRequest = GM_xmlhttpRequest;
    }
    else
    {
        console.error('[CG Enhancer] Greasemonkey is not supported');
        return;
    }

    if (!GMsetValue)
    {
        console.error('[CG Enhancer] Error: Could not detect userscript manager');
        return;
    }

    if (useAgentModule)
    {
        // required to access codingame local api
        // done first before angular has time to load
        const ngDebugStr = 'NG_ENABLE_DEBUG_INFO!';
        if (unsafeWindow.name.indexOf(ngDebugStr) === -1)
            unsafeWindow.name = ngDebugStr + unsafeWindow.name;
    }

    // jquery
    const $ = window.jQuery;
    const angular = unsafeWindow.angular;

    // agent images
    const ideImage = document.createElement('img');
    $(ideImage).attr('class', 'selectAgentImage ideImage')
        .attr('src', 'https://i.imgur.com/yNpEfYt.png')
        .attr('style', 'cursor: pointer;');  // .css doest not work

    const arenaImage = document.createElement('img');
    $(arenaImage).attr('class', 'selectAgentImage arenaImage')
        .attr('src', 'https://i.imgur.com/VkG3qnf.png')
        .attr('style', 'cursor: pointer;');  // .css doest not work

    const bossImage = document.createElement('img');
    $(bossImage).attr('class', 'selectAgentImage bossImage')
        .attr('src', 'https://i.imgur.com/bbVA7Qv.png')
        .attr('style', 'cursor: pointer;');  // .css doest not work

    const binImage = document.createElement('img');
    $(binImage).attr('class', 'binImage')
        .attr('src', 'https://i.imgur.com/HFPFSnc.png')
        .attr('style', 'cursor: pointer; right: 20px; bottom: 7px; position: absolute;');  // .css doesnt not work

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
    var lastLeaderboardUpdate; // timer used to avoid spamming leaderboards request

    // templates construction
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
            <p class='p-name' ` + attrs + `
                style='font-size: 18px; margin-top: 3px; float:left; display:inline-block;` + baseStyle + `{{defaultStyle}}` + `'>
                    {{value}}
            </p>
        </div>`;


    // rank over avatar template
    const rankAvatarCss = `
        text-font: bold;
        text-shadow: #000 1px 1px, #000 -1px 1px, #000 -1px -1px, #000 1px -1px;
        margin-left: 5px;
        font-weight: 600;
        color: rgb(255, 255, 255);
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
            lastLeaderboardUpdate = null;
        }

        // check user pseudonym
        const pseudoDiv = $('.navigation-profile_nav-profile-nickname').first();
        if (!userPseudo && pseudoDiv)
        {
            userPseudo = pseudoDiv.attr('title');
            if (userPseudo)
                console.log('[CG Enhancer] User pseudonym: ' + userPseudo);
        }

        // if not in IDE
        if ($(location).attr('pathname').indexOf('ide/') === -1)
        {
            // remove community notifications
            const contributionNav = $('#navigation-contribute');
            if (contributionNav)
            {
                const bubbleNotif = contributionNav.find('.cg-notification-bubble').first();
                if (bubbleNotif)
                    bubbleNotif.remove();
            }
        }

        // we are in the IDE and main is loaded
        if ($(location).attr('pathname').indexOf('ide/') !== -1 && $('.main').length)
        {
            if (useAgentModule)
            {
                // get agentApi if needed or disable agentModule
                if (!agentApi)
                    getAgentApi();

                // make sure the IDE has the correct layout
                if ($('.code-bloc').first().css('bottom') !== '295px')
                    handleRightBlocLayout();
                handleLeftBlocLayout();

                // add agent buttons
                manageAgentPanel();
            }

            // check if we opened last battles without looking at all mutations
            const firstMutation = $(mutations[0].target);
            if (firstMutation.attr('class') && firstMutation.attr('class').indexOf('cg-ide-last-battles') !== -1)
            {
                console.log('[CG Enhancer] Opened last battles');
                blockTvViewer = true;
                updatePlayersData();
            }

            // block tv viewer if opened
            if (blockTvViewer)
            {
                // hide battle tv on last battles tab opening
                const battleTv = $('.battle-tv').first();
                if (battleTv)
                {
                    // hide battleTv
                    battleTv.attr('class', 'battle-tv-hidden');

                    // reveal if clicked
                    battleTv.click(function() {
                        blockTvViewer = false;
                        $(this).attr('class', 'battle-tv');
                    });
                }
            }

            // trigger tv-battle close button
            const showButton = $('.battle-tv-hidden .battle-button-label').first();
            if (showButton && showButton.text() === 'Close')
                showButton.trigger('click');


            // add ranks on last battle tab, if open
            // this part is not updated with new leaderboard query
            if ($('.cg-ide-last-battles').length)
                manageLastBattlesTab();

            // if the history tab is open
            if ($('.cg-ide-results').length)
                manageHistoryTab();
        }
    });


    var waitingForDocument = setInterval(function()
    {
        // configuration of the observer:
        var config = { attributes: true, childList: true, characterData: true, subtree: true};

        // disallow sound for notifications
        if (unsafeWindow.session.notificationConfig.soundEnabled !== enableSound)
            unsafeWindow.session.notificationConfig.soundEnabled = enableSound;

        // remove notifications
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

    /** create swap button if no cgspunk is detected */
    function handleSwapButton()
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
            const panel = $('.scroll-panel').first();
            if (panel)
                panel.append(swapButton);
            $('#cgeSwapButton').click(rotateAgents);
        }

        // remove swap button if cgspunk swap button here
        if ($('#cgspkSwapButton').length !== 0 && $('#cgeSwapButton').length !== 0)
        {
            console.log('[CG Enhancer] Remove swap button');
            const swapButton = $('#cgeSwapButton');
            swapButton.remove();
        }
    }

    /** called at the opening of the ide tab to add the correct display to the right bloc */
    function handleRightBlocLayout()
    {
        if (!lastCodeBlocUpdate || (new Date() - lastCodeBlocUpdate > 100))  // max one each 0.1ms
        {
            // the timer is required on firefox (otherwise it creates an infinite loop competing against angular)

            lastCodeBlocUpdate = new Date();

            const bloc_container = $('.blocs-container').first();
            const height = bloc_container.height();
            const top295 = (height - 295) + 'px';
            const agentSubmitBloc = $('.testcases-actions-container').first();
            const codeBloc = $('.code-bloc').first();

            if (codeBloc.css('bottom') !== '295px')
                codeBloc.css('bottom',     '295px');

            if (agentSubmitBloc.css('top') !== top295)
                agentSubmitBloc.css('top', top295);
        }
    }

    /** called after each mutation in case the player opens/closes the console */
    function handleLeftBlocLayout()
    {
        if (!lastCodeBlocUpdate || (new Date() - lastCodeBlocUpdate > 100))  // max one each 0.1ms
        {
            // the timer is required on firefox (otherwise it creates an infinite loop competing against angular)

            lastCodeBlocUpdate = new Date();

            const bloc_container = $('.blocs-container').first();
            const height = bloc_container.height();
            const top295 = (height - 295) + 'px';
            const top52  = (height -  52) + 'px';
            const consoleBloc = $('.console-bloc').first();
            const statementBloc = $('.statement-bloc').first();

            if (!consoleBloc.find('.header-button.unminimize-button').length)
            {
                // the console is open
                if (consoleBloc.css('top') !== top295)
                    consoleBloc.css('top', top295);
                if (statementBloc.css('bottom') !== '295px')
                    statementBloc.css('bottom',     '295px');
            }
            else
            {
                // the console is minimized
                if (consoleBloc.css('top') !== top52)
                    consoleBloc.css('top', top52);
                if (statementBloc.css('bottom') !== '52px')
                    statementBloc.css('bottom',     '52px');
            }
        }
    }

    /** create agent fast selection tools */
    function manageAgentPanel()
    {
        // make sure agentApi is operational
        if (!agentApi)
            return;

        // create swap button if no cgspunk is detected
        handleSwapButton();

        // add buttons for each agent
        $('.agent').each(function(agentIdx, agent) {
            if ($(agent).find('.fastSelectButtons').length)
                return;

            $(agent).append(`<div class='fastSelectButtons'></div>`);
            const fastDiv = $(agent).find('.fastSelectButtons').first();
            $(ideImage).clone().appendTo(fastDiv);
            fastDiv.find('.ideImage').first().click(function() {
                addAgent(agentIdx, 'ide');
            });
            $(arenaImage).clone().appendTo(fastDiv);
            fastDiv.find('.arenaImage').first().click(function() {
                addAgent(agentIdx, 'arena');
            });
            $(bossImage).clone().appendTo(fastDiv);
            fastDiv.find('.bossImage').first().click(function() {
                addAgent(agentIdx, 'boss');
            });

            // add input
            $(agent).append(`<div class='fastInput'></div>`);
            const inputDiv = $(agent).find('.fastInput').first();
            inputDiv.append(`<input class='fastAgentInput' type='text' />`);
            const inputBox = inputDiv.find('.fastAgentInput').first();
            inputBox.keyup({'index': agentIdx}, addFastPlayer);

            inputBox
                .css('width', '80px')
                .css('height', '20px')
                .css('padding-left', '5px')
                .css('background-color', 'rgb(112, 112, 112)')
                .css('color', 'rgb(255, 255, 255)')
                .css('margin-bottom', '0px');

            updatePlayersData();
        });
    }

    /** the coloration/rank is only computed once at the opening of the tab / the end of the game */
    function manageLastBattlesTab()
    {
        $('.battle-done').not(':has(.cge-player-rank)').each(function(index, battleDiv) {
            // TODO
            // might crash for some browsers because of color conversion
            // check https://stackoverflow.com/a/11943970 for a safe way to code it

            const color = getColor(battleDiv);
            $(battleDiv).css('background-color', color);

            $(battleDiv).find('.player-agent').each(function(avatarIndex, playerAvatar) {
                const player = $(playerAvatar).attr('title');
                if (player && player !== userPseudo)
                {
                    const playerAgent = playersData[player.toLowerCase()];
                    const rank = playerAgent ? playerAgent.localRank : '';
                    const rankDiv =
                        `<div class='cge-player-rank' style='` + rankAvatarCss + `'>` +
                            rank +
                        `</div>`;
                    $(playerAvatar).append(rankDiv);
                }
            });
        });
    }

    /**
     * add name/rank/elo divs to submit div
     * @param {Object} options
     */
    function addSubmitDiv(options)
    {
        const storageHash = options.storageHash + options.type;
        const divOptions = {
            'storageHash': storageHash,
            'default': options.type,
            'defaultStyle': options.defaultStyle
        };
        const newDiv = getDiv(divOptions, options.template);
        options.root.append(newDiv)
            .find('.p-' + options.type).first()
            .click(clickEvent)
            .keypress({'type': options.type, 'default': options.type, 'storageHash': storageHash}, keyPressEvent);
    }

    /** handles submits naming, ranking/elo storage */
    function manageHistoryTab()
    {
        $('.submission-card').not(':has(.date-name-div)').each(function(index, submission) {
            // create left side div (date + name)
            $(submission)
                .children().not('.ide-icon_arrow_black')
                .wrapAll( '<div class="date-name-div" />');

            // date is required for storageHash
            const date = $(submission).find('.date').first();

            const storageHash = pathName + date.attr('title');

            // add flex style
            $(submission).css('display',     'flex');
            $(submission).css('flex-direction',     'column');
            $(submission).css('flex-wrap',     'wrap');


            // modify data display for an exact date
            date.text(date.attr('title'));
            date.css('font-size', '12px');


            // create icon side div (arrow + bin)
            $(submission)
                .find('.ide-icon_arrow_black')
                .wrapAll( '<div class="icons-div" />');

            const dateNameDiv = $(submission).find('.date-name-div').first();
            dateNameDiv
                .css('float', 'left')
                .css('width', '150px')
                .css('display', 'flex')
                .css('flex-direction', 'inherit')
                .css('margin-top', '-12px');

            // create right side div (rank + elo)
            $(submission).append(`<div class='rank-elo-div'></div>`);
            const rankEloDiv = $(submission).find('.rank-elo-div').first();
            rankEloDiv
                .css('width', '100px')
                .css('align-self', 'flex-end')
                .css('display', 'inline-grid');

            const iconsDiv = $(submission).find('.icons-div');
            $(binImage).clone().appendTo(iconsDiv);
            iconsDiv
                .find('.binImage')
                .click(function(event) {
                    $(submission).css('display', 'none');
                    GMsetValue(storageHash + 'display', 'none'); /* jshint ignore:line */
                    event.stopPropagation();
                });

            // add name storage
            const options = {};
            // commun options
            options.storageHash = storageHash;
            options.defaultStyle = 'color: rgb(224, 224, 224);';

            // add name storage
            options.type = 'name';
            options.template = nameDivTemplate;
            options.root = dateNameDiv;
            addSubmitDiv(options);

            // add rank storage
            options.type = 'rank';
            options.template = rankDivTemplate;
            options.root = rankEloDiv;
            addSubmitDiv(options);

            // add elo storage
            options.type = 'elo';
            options.template = eloDivTemplate;
            options.root = rankEloDiv;
            addSubmitDiv(options);


            const display = GMgetValue(storageHash + 'display'); /* jshint ignore:line */
            console.log(storageHash + 'display' + ': ' + display);
            if (display === 'none')
            {
                $(submission).css('display', 'none');
                return;
            }
        });

        if ($('.cg-ide-submissions').length && $('.restoreDiv').length === 0)
        {
            $('.cg-ide-submissions').append('<div class="restoreDiv">restore all</div>');
            $('.restoreDiv').first()
                .css('position', 'absolute')
                .css('bottom', '30px')
                .css('right', '40px')
                .css('color', '#aaaaaa')
                .css('cursor', 'pointer')
                .click(function(event) {
                    $('.submission-card').each(function(index, submission) {
                        // date is required for storageHash
                        const date = $(submission).find('.date').first();

                        const storageHash = pathName + date.attr('title');
                        if ($(submission).css('display') === 'none')
                        {
                            $(submission).css('display', 'flex');
                            GMsetValue(storageHash + 'display', 'flex'); /* jshint ignore:line */
                            return;
                        }
                    });
                    manageHistoryTab();
                    event.stopPropagation();
                });
        }
    }


    /** try to get angular api or disable agent panel */
    function getAgentApi()
    {
        const agentForApi = $('.agent').filter(':first');
        if (useAgentModule && agentForApi)
        {
            // if angular is indeed in debug mode
            if (angular.element(agentForApi).scope())
                agentApi = angular.element(agentForApi).scope().api;
            else
            {
                console.error('[CG Enhancer] Please refresh the tab to use the agent module. ' +
                              'If it doesn\'t work, ask Azkellas or post on the forum/github');
                useAgentModule = false;
            }
        }
        else
        {
            console.warn('[CG Enhancer] Agent panel is not fully loaded yet');
        }
    }

    /**
     * @param {int} index - index of agent scope to apply
     */
    function applyAgent(index)
    {
        angular.element('.agent').eq(index)
            .scope().$apply();
    }

    /**
     * @param {int} index - index of agent to remove
     */
    function removeAgent(index)
    {
        agentApi.removeAgent(index);
        applyAgent(index);
    }

    /**
     * @param {int} index - index of agent to add
     * @param {string} type - type or pseudo of agent to add
     */
    function addAgent(index, type)
    {
        removeAgent(index);
        const agent = angular.element('.agent').eq(index);

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

        applyAgent(index);
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

        $('.agent').each(function(index, agent) {
            agent = angular.element(agent);
            if (agent.scope().$parent.agent !== null) // check if there is indeed an agent or if the agent is empty
                agents.push(agent.scope().$parent.agent);
        });

        // shift agents
        agents.push(agents.shift());

        // add agents
        for (let index = 0; index < agents.length; index++) {
            removeAgent(index);
            const agent = angular.element('.agent').eq(index);
            agent.scope().api.addAgent(agents[index]);
            applyAgent(index);
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
        const name = GMgetValue(data.storageHash, data.default); /* jshint ignore:line */
        console.log(data.storageHash + ': ' + name);
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
     * note: giving rgb values is mandatory for firefox
     * @param {jquery object} battleDiv
     */
    function getColor(battleDiv)
    {
        // if more than 2 players, not coloration
        if ($(battleDiv).find('.player-agent').length > 2)
            return 'rgb(255, 255, 255)';

        // userAgent undefined
        if (!userAgent)
            return 'rgb(255, 255, 255)';

        let userRank;
        let enemyRank;
        let userWon;

        $(battleDiv).find('.player-agent').each(function(playerIdx, playerAvatar) {
            const player = $(playerAvatar).attr('title');
            if (player && playersData[player.toLowerCase()] && player !== userPseudo)
                enemyRank = playersData[player.toLowerCase()].localRank;
            if (player && player === userPseudo)
            {
                userRank = userAgent.localRank;
                userWon = (playerIdx === 0);
            }
        });

        // at least one undefined rank
        if (!userRank || !enemyRank || !userWon)
            return 'rgb(240, 240, 240)';

        // unexpected loss
        if (enemyRank > 1.2*userRank + 10 && !userWon)
            return '#rgb(255, 240, 240)';

        // unexepcted win
        if (userRank > 1.2*enemyRank + 10 && userWon)
            return 'rgb(240, 255, 240)';

        // expected result
        return 'rgb(255, 255, 255)';
    }

    /**
     * stop propagation
     * @param {DOM event} event
     */
    function clickEvent(event)
    {
        /* jshint validthis: true */
        if (!this)
        {
            console.error('[CG Enhancer] Error: clickEvent must be called inside a click method.');
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
        /* jshint validthis: true */
        if (!this)
        {
            console.error('[CG Enhancer] Error: addFastPlayer must be called inside a keypress method.');
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
                $(this).css('color', 'rgb(255, 255, 255');  // reset color
                $(this).blur();  // focus out
            }
            // player not found
            else
            {
                console.log('[CG Enhancer] Player ' + pseudo + ' could not be found');
                $(this).css('color', 'rgb(255, 160, 160)');  // red coloration if player not found
            }

            // prevent codingame action
            event.stopPropagation();
        }
        else
        {
            // reset color to white
            $(this).css('color', 'rgb(255, 255, 255)');
        }
    }

    /**
     * called in the history tab
     * @param {DOM event} event - contains data
     */
    function keyPressEvent(event)
    {
        /* jshint validthis: true */
        // event.data :
        //    {
        //      type
        //      defaultValue
        //      storageHash
        //    }

        if (!this)
        {
            console.error('[CG Enhancer] Error: keyPressEvent must be called inside a keyUp method.');
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
            GMsetValue(event.data.storageHash, $(this).text()); /* jshint ignore:line */

            // apply coloration
            if ($(this).text() !== event.data.default)
                $(this).css('color', '');
            else
                $(this).css('color', 'rgb(224, 224, 224)');

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
        if (lastLeaderboardUpdate && (new Date() - lastLeaderboardUpdate < 60*1000))
            return;

        // reset stored leaderboard and user/boss agents
        lastLeaderboardUpdate = new Date();
        playersData = {};
        userAgent = null;
        bossAgent = null;

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
                    console.error('[CG Enhancer] api request failed with error: ' + error);
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
            GMxmlhttpRequest({ /* jshint ignore:line */
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
