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
- **Score Tracking:** Your score is displayed and updated in real-time.
- **New Game:** You can start a new game at any time by clicking the "New Game" button.
- **Game Over State:** The game clearly indicates when the game is over and provides an option to try again.
- **Touch Controls:** In addition to keyboard controls, you can play the game by swiping on touch-enabled devices.

## How to Run Locally

No special setup is required! Simply open the `index.html` file in your favorite web browser to start playing.

## Technical Details

This game is built with:

- **HTML:** For the basic structure of the game.
- **CSS:** For styling the game board, tiles, and other UI elements.
- **JavaScript:** For all the game logic, including tile movement, merging, scoring, and event handling.

The game is fully self-contained in the `index.html` file and has no external dependencies other than Google Fonts.
