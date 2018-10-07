# CG Enhancer

Github repository of [CG Enhancer](link-to-codingame-forum-post)

The goal of this script is to make the user's life easier, especially during multi/contests. It comes with a bunch of features (see below for an exhaustive or-so list).

It currently **does not** work with firefox, only tested with chromium and chrome.

I'm already surprised I made it work for my browser, so do not expect it to work perfectly on yours (at least for now). It is only my second time using javascript (and first with jquery/angular) so the code is without doubt full of atrocities, bad habits and more. Feel free to report them or to improve the code if you're brave enough to have a look at it. :)

## Features

### Notifications
* Disable sound
* Disable `clash-invite` and `follow` notifications
For further personalization, look for `// disallow sound for notifications` and `// notifications` in the source code (no panel yet).

### Global
* disable community red notification at the top while browsing CG.

### IDE

#### Agent panel
* Swap button like CG spunk
* Button for fast selection (IDE / Arena / Boss agents)
* Input for fast player selection ('Magus', 'Azkellas')

![AgentExample](https://i.imgur.com/6lgwYNS.gif)


#### History tab
* Display the full date
* Possibility to rename submits
* Possibility to save the rank and the elo of submits

![HistoryExample](https://image.ibb.co/eDarJp/history.gif)


#### Last battles tab
* Disable the tv-battle at opening (game is still loaded but not displayed)
* Show opponents' rankings (if in the top1000)
* Highlight unexpected results (winning against a better opponent / losing against a worse opponent)

![LastBattlesExample](https://image.ibb.co/hTop4U/lastbattles.gif)


## Possible todos
### Tab history
* Possibility to erase submits (bin tab)
* Possibility to create tabs
* Automatically store the submit rank

### Last battles:
* Add winrates (with cgstats) 
* Highlight timeouts

### IDE:
* Replace the `<input/>` fast agent choice by a reactive `<ng-select>` (help needed)
* Add the possibility to chose between the local leaderboard (current div and lower) and global leaderboard (from legend to bottom) to chose agents
* Synchronize storage data for multi browser support (requires making it an app)
