/**
 * Estado externo "sidebar recolhida" (043).
 *
 * Por que um store e não `useState` + `useEffect`: `localStorage` é uma fonte
 * externa ao React e o valor só existe no cliente. Ler no efeito e chamar
 * `setState` derrubaria o lint (`react-hooks/set-state-in-effect`) e causaria
 * um render extra com flash do layout. `useSyncExternalStore` é o hook feito
 * para isso — `getServerSnapshot` fixa o valor do servidor (expandida) e o
 * cliente corrige na primeira pintura, sem divergência de hidratação.
 */

const STORAGE_KEY = "serralheria:sidebar";

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Assina mudanças — inclusive as de outras abas (evento `storage`). */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function getSnapshot(): boolean {
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

/** Servidor sempre pinta expandido; o cliente corrige depois. */
function getServerSnapshot(): boolean {
  return false;
}

export const sidebarCollapsedStore = { subscribe, getSnapshot, getServerSnapshot };

/** Grava a preferência e notifica os componentes abertos. */
export function setSidebarCollapsed(collapsed: boolean): void {
  window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  emit();
}
