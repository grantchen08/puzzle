# City Merge Puzzle

A simple and addictive puzzle game where you merge tiles to build a bigger and more advanced city. This game is a variant of the popular 2048 puzzle game, with a city-building theme.

**[Play the game online here!](https://grantchen08.github.io/puzzle/)**

## Gameplay & Rules

The goal of the game is to get the highest score possible by merging tiles.

- Use the **arrow keys** on your keyboard or **swipe** on a touch screen to move all tiles in a direction (Up, Down, Left, or Right).
- When two tiles with the same building on them touch, they will **merge** into a single, more advanced building.
- Each merge increases your **score**. The score for a new building is the value of the new tile.
- A new, basic tile (a tent) will appear in a random empty spot on the board after every move.
- The game ends when the board is full and there are no more possible moves (no adjacent identical tiles).

## Tile Progression

The buildings evolve as you merge them, starting from a simple tent and growing into a futuristic cityscape. Here is the progression:

1.  ⛺ (Tent)
2.  🛖 (Hut)
3.  🏠 (House)
4.  🏡 (House with Garden)
5.  🏢 (Office Building)
6.  🏙️ (Cityscape)
7.  🏰 (Castle)
8.  🏛️ (Classical Building)
9.  🗼 (Tokyo Tower)
10. 🚀 (Rocket)

## Features

- **Responsive Design:** The game is playable on both desktop and mobile devices.
- **Score Tracking:** Your current score and personal best are displayed with animated counting.
- **High Score:** Your best score is saved locally and persists across sessions.
- **New Game:** You can start a new game at any time by clicking the "New Game" button.
- **Game Over State:** The game clearly indicates when the game is over, celebrates new records, and provides an option to try again.
- **Touch Controls:** In addition to keyboard controls, you can play the game by swiping on touch-enabled devices.
- **Sound Effects:** Satisfying sounds for merges and new tiles (with mute option).
- **Background Music:** Retro chiptune-style music generated in JavaScript (Web Audio). Starts after your first input (browser autoplay rules) and follows the mute toggle.
- **Settings & Debug Log:** A settings panel (⚙️) lets you toggle **Sound Effects** and **Background Music** separately, and view/copy an in-game **Game Log** (useful for diagnosing audio issues on hosted pages like GitHub Pages).

### Visual Effects & "Game Juice"

The game features polished animations and effects inspired by popular mobile games:

- **Smooth Tile Sliding:** Tiles glide smoothly across the board with eased motion.
- **Merge Effects:** Tiles pulse with an elastic bounce effect and emit colorful particle bursts.
- **Floating Score Pop-ups:** "+64", "+128" etc. float up from merge locations.
- **Tile Glow:** Higher-level tiles (🏢 and above) emit a pulsing colored glow/aura.
- **Screen Shake:** The board shakes on merges — intensity scales with tile level.
- **Combo System:** Merge multiple pairs in one move for "COMBO!", "SUPER!", "AMAZING!" messages.
- **Milestone Celebrations:** Special messages and confetti when reaching 🏰 Castle and above.
- **Confetti Explosions:** Colorful confetti rains down for big achievements.
- **New Tile Pop-in:** New tiles appear with a satisfying pop-in animation.
- **Score Animation:** The score counter animates and bounces when points are earned.

## How to Run Locally

No special setup is required! Simply open the `index.html` file in your favorite web browser to start playing.

## Technical Details

This game is built with:

- **HTML:** For the basic structure of the game.
- **CSS:** For styling the game board, tiles, and other UI elements.
- **JavaScript:** For all the game logic, including tile movement, merging, scoring, and event handling.
- **Web Audio API:** For generated chiptune-style background music.

The game is fully self-contained in the `index.html` file and has no external dependencies other than Google Fonts.
