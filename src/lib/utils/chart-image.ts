/**
 * Exportação dos gráficos (Recharts/SVG) como PNG.
 *
 * O SVG é serializado com as cores resolvidas — as barras usam
 * `var(--primary)` etc. e, fora do documento, as variáveis CSS não
 * existem. O canvas é desenhado em 2x para a imagem não sair borrada.
 */

const EXPORT_SCALE = 2;
const PADDING = 20;
const TITLE_HEIGHT = 26;
const SUBTITLE_HEIGHT = 18;

export interface ChartPngOptions {
  /** Nome do arquivo (a extensão .png é adicionada se faltar). */
  fileName: string;
  title: string;
  subtitle?: string;
}

function cssVariable(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** Substitui `var(--token)` pelo valor computado do tema. */
function resolveVariables(value: string): string {
  return value.replace(
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g,
    (_match, name: string, fallback?: string) =>
      cssVariable(name, fallback?.trim() || "currentColor"),
  );
}

/** Copia as cores/fontes computadas do SVG original para o clone. */
function inlineComputedStyles(original: SVGSVGElement, clone: SVGSVGElement): void {
  const originals = [original, ...Array.from(original.querySelectorAll("*"))];
  const clones = [clone, ...Array.from(clone.querySelectorAll("*"))];

  for (let index = 0; index < originals.length; index += 1) {
    const source = originals[index];
    const target = clones[index] as SVGElement | undefined;
    if (!source || !target || !(target instanceof SVGElement)) continue;

    const computed = getComputedStyle(source);
    target.style.fill = computed.fill;
    target.style.stroke = computed.stroke;
    target.style.strokeWidth = computed.strokeWidth;
    target.style.opacity = computed.opacity;
    target.style.fillOpacity = computed.fillOpacity;
    target.style.strokeOpacity = computed.strokeOpacity;
    target.style.fontFamily = computed.fontFamily;
    target.style.fontSize = computed.fontSize;
    target.style.fontWeight = computed.fontWeight;
    target.style.textAnchor = computed.textAnchor;
  }

  // Reforço para navegadores que não resolvem var() em atributos SVG.
  for (const element of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
    for (const attribute of ["fill", "stroke", "color"]) {
      const value = element.getAttribute(attribute);
      if (value?.includes("var(")) {
        element.setAttribute(attribute, resolveVariables(value));
      }
    }
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Não foi possível renderizar o gráfico."));
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Não foi possível gerar a imagem."));
    }, "image/png");
  });
}

/**
 * Baixa o gráfico contido em `container` como PNG (fundo do card + título).
 * A imagem sai com o tema atual — claro ou escuro.
 */
export async function downloadChartPng(
  container: HTMLElement,
  options: ChartPngOptions,
): Promise<void> {
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("Gráfico não encontrado.");

  const width = Math.max(1, Math.round(container.clientWidth || svg.clientWidth));
  const height = Math.max(1, Math.round(container.clientHeight || svg.clientHeight));

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  inlineComputedStyles(svg, clone);

  const background = cssVariable("--card", "#ffffff");
  const foreground = cssVariable("--foreground", "#14181f");
  const muted = cssVariable("--muted-foreground", "#5b6472");

  const headerHeight =
    PADDING + TITLE_HEIGHT + (options.subtitle ? SUBTITLE_HEIGHT : 0);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((width + PADDING * 2) * EXPORT_SCALE);
  canvas.height = Math.round((height + headerHeight + PADDING) * EXPORT_SCALE);

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível gerar a imagem.");
  context.scale(EXPORT_SCALE, EXPORT_SCALE);
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width / EXPORT_SCALE, canvas.height / EXPORT_SCALE);

  context.fillStyle = foreground;
  context.font = "600 14px system-ui, sans-serif";
  context.fillText(options.title, PADDING, PADDING + 14);

  if (options.subtitle) {
    context.fillStyle = muted;
    context.font = "11px system-ui, sans-serif";
    context.fillText(options.subtitle, PADDING, PADDING + TITLE_HEIGHT + 8);
  }

  const serialized = new XMLSerializer().serializeToString(clone);
  const svgUrl = URL.createObjectURL(new Blob([serialized], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = await loadImage(svgUrl);
    context.drawImage(image, PADDING, headerHeight, width, height);

    const blob = await canvasToBlob(canvas);
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = options.fileName.endsWith(".png")
      ? options.fileName
      : `${options.fileName}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(downloadUrl);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
