import "@fontsource/silkscreen/400.css";
import "@fontsource/silkscreen/700.css";
import "@fontsource/vt323/400.css";
import "@fontsource/space-mono/400.css";
import "./style.css";
import { App } from "./app";
import { mountUi } from "./ui";

const canvas = document.getElementById("universe") as HTMLCanvasElement;
const deck = document.getElementById("deck") as HTMLElement;

const app = new App(canvas);
mountUi(app, deck);
app.start();

// Keyboard shortcuts (not while typing in a field).
window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target instanceof Element && e.target.closest("input, textarea, select")) return;
  const key = e.key.toLowerCase();
  if (key === "r") app.randomize();
  else if (key === "a") app.setAutopilot(!app.state.autopilot);
});
