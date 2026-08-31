# Balancedle

A tiny deterministic daily balancing puzzle game built with Vite + TypeScript + Canvas.

## Deployment

Live site: https://balancedle-shiiirro.vercel.app/

## Stack

- Vite
- TypeScript
- HTML/CSS
- Canvas 2D
- No physics engine
- No framework

Vite is used only for the dev server/build pipeline. The game itself is custom geometry.

## Run in VS Code + WSL

```bash
npm install
npm run dev -- --host 0.0.0.0
```

Open the local Vite URL in your browser.

## Controls

- Press down **outside the shape** and move the pointer around its center to rotate it.
- Press down **inside the shape** and drag it to position it.
- Upon releasing after positioning, the shape drops immediately and then falls until it lands on the fulcrum or falls past it.
- Click the help button for better explanations :3
