export type Theme = "light" | "dark";
const KEY = "atlet:theme";

function system(): Theme {
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}
function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function initTheme(): Theme {
  const theme = stored() ?? system();
  apply(theme);
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (!stored()) apply(system());
  });
  return theme;
}
export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private mode */
  }
  apply(next);
  return next;
}
