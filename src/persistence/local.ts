import {GameState} from "../game";

export interface SavedGameState {
    puzzleId: string;
    gameState: GameState;
    attempts: number;
    x: number;
    y: number;
    rotation: number;
    hintStage: number;
}

const STORAGE_KEY = "balancedle";

export function save(state: SavedGameState): void {
    const json = JSON.stringify(state);
    window.localStorage.setItem(STORAGE_KEY, json);
}

export function load(): SavedGameState | null {
    const json = window.localStorage.getItem(STORAGE_KEY);

    if (json === null) {
        return null;
    }

    try {
        return JSON.parse(json) as SavedGameState;
    } catch {
        return null;
    }
}

export function clear(): void {
    window.localStorage.removeItem(STORAGE_KEY);
}
