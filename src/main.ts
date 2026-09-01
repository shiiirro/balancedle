import "./style.css";
import { Balancedle } from "./game";
import { getPlayer, supabase } from "./persistence/supabase";
import { createClient, FunctionsHttpError } from "@supabase/supabase-js";
import { load } from "./persistence/local";

let hasStats = false;
let notificationTimeout: number | undefined;

function requiredElement<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing game UI element: ${selector}`);
    return element;
}

const statsButton = requiredElement<HTMLButtonElement>("#statsButton");
const helpButton = requiredElement<HTMLButtonElement>("#helpButton");

const canvas = requiredElement<HTMLCanvasElement>("#game");
const resultOverlay = requiredElement<HTMLElement>("#resultOverlay");

const resultKicker = requiredElement<HTMLElement>("#resultKicker");
const resultTitle = requiredElement<HTMLElement>("#resultTitle");

const averageAttempts = requiredElement<HTMLElement>("#averageAttempts");
const daysPlayed = requiredElement<HTMLElement>("#daysPlayed");
const currentStreak = requiredElement<HTMLElement>("#currentStreak");
const maxStreak = requiredElement<HTMLElement>("#maxStreak");
const distributionChart = requiredElement<HTMLElement>("#distributionChart");

const shareButton = requiredElement<HTMLButtonElement>("#shareButton");
const closeResult = requiredElement<HTMLButtonElement>("#closeResult");

const closeHelp = requiredElement<HTMLButtonElement>("#closeHelp");
const closeHelpButton = requiredElement<HTMLButtonElement>("#closeHelpButton");
const helpOverlay = requiredElement<HTMLDivElement>("#helpOverlay");

async function showResult(attempts: number): Promise<void> {
    await getPlayer();

    const { data, error } = await supabase.functions.invoke("submit-result", {
        body: {
            puzzleId: game.puzzle.id,
            attempts: attempts,
        },
    });

    if (error) {
        console.error("Function error:", error);
        if (error instanceof FunctionsHttpError) {
            const body = await error.context.json();
            console.error("Function response:", body);
        }
    }

    const distribution = Array(7).fill(0) as number[];

    for (const [attempts, count] of Object.entries(data.result.distribution)) {
        const attemptCount = Number(attempts);
        if (attemptCount >= 7) {
            distribution[6] += Number(count);
        } else if (attemptCount >= 1) {
            distribution[attemptCount - 1] += Number(count);
        }
    }

    resultKicker.textContent = `BALANCEDLE (${game.puzzle.id})`;

    resultTitle.textContent = `${attempts} ${attempts === 1 ? "ATTEMPT" : "ATTEMPTS"}`;

    averageAttempts.textContent = data?.stats?.averageAttempts.toFixed(1) || "0.0";

    daysPlayed.textContent = String(data?.stats?.daysPlayed || 0);

    currentStreak.textContent = String(data?.stats?.currentStreak || 0);

    maxStreak.textContent = String(data?.stats?.maxStreak || 0);

    renderDistribution(distribution, attempts);

    resultOverlay.classList.remove("hidden");
    resultOverlay.setAttribute("aria-hidden", "false");

    hasStats = true;
}

function renderDistribution(distribution: number[], playerAttempts: number): void {
    distributionChart.replaceChildren();

    const labels = ["1", "2", "3", "4", "5", "6", "7+"];

    const totalPlayers = distribution.reduce((sum, value) => sum + value, 0);

    const maxPercentage = Math.max(...distribution.map((count) => (totalPlayers > 0 ? (count / totalPlayers) * 100 : 0)), 1);

    distribution.forEach((count, index) => {
        const row = document.createElement("div");
        row.className = "distribution-row";

        const label = document.createElement("span");
        label.className = "distribution-label";
        label.textContent = labels[index];

        const bar = document.createElement("div");
        bar.className = "distribution-bar";

        const fill = document.createElement("span");
        fill.className = "distribution-fill";

        const percentage = totalPlayers > 0 ? (count / totalPlayers) * 100 : 0;

        fill.style.width = `${Math.max((percentage / maxPercentage) * 100, percentage > 0 ? 3 : 0)}%`;

        fill.textContent = `${percentage.toFixed(0)}%`;

        if (index === playerAttempts - 1 || (playerAttempts >= 7 && index === 6)) {
            fill.classList.add("current");
        }

        bar.appendChild(fill);
        row.append(label, bar);
        distributionChart.appendChild(row);
    });
}

function showFinishNotification(): void {
    const notification = document.getElementById("finishNotification");
    if (!notification) {
        return;
    }
    notification.classList.add("visible");
    notification.setAttribute("aria-hidden", "false");
    if (notificationTimeout !== undefined) {
        window.clearTimeout(notificationTimeout);
    }
    notificationTimeout = window.setTimeout(() => {
        notification.classList.remove("visible");
        notification.setAttribute("aria-hidden", "true");
    }, 2000);
}

function hideResultPopup(): void {
    resultOverlay.classList.add("hidden");
    resultOverlay.setAttribute("aria-hidden", "true");
}

function hideHelpOverlay(): void {
    helpOverlay.classList.add("hidden");
    helpOverlay.setAttribute("aria-hidden", "true");
}

helpButton.addEventListener("click", () => {
    helpOverlay.classList.remove("hidden");
    helpOverlay.setAttribute("aria-hidden", "false");
});

closeHelp.addEventListener("click", hideHelpOverlay);
closeHelpButton.addEventListener("click", hideHelpOverlay);
closeResult.addEventListener("click", hideResultPopup);

resultOverlay.addEventListener("click", (event) => {
    if (event.target === resultOverlay) hideResultPopup();
});

helpOverlay.addEventListener("click", (event) => {
    if (event.target === helpOverlay) hideHelpOverlay();
});

statsButton.addEventListener("click", () => {
    if (!hasStats) {
        showFinishNotification();
        return;
    }
    resultOverlay.classList.remove("hidden");
    resultOverlay.setAttribute("aria-hidden", "false");
});

const game = new Balancedle(canvas, showResult);

(window as Window & { balanceGame?: Balancedle }).balanceGame = game;

shareButton.addEventListener("click", async () => {
    const text = shareButton.dataset.shareText ?? `Balancedle (${game.puzzle.id}) solved in ✅ ${resultTitle.textContent} ✅`;
    try {
        await navigator.clipboard.writeText(text);
        shareButton.textContent = "COPIED";
        window.setTimeout(() => (shareButton.textContent = "SHARE"), 1200);
    } catch {
        shareButton.textContent = text;
    }
});

if (!load()) {
    helpOverlay.classList.remove("hidden");
    helpOverlay.setAttribute("aria-hidden", "false");
}
