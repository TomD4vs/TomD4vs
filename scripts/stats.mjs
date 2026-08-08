// Gera um card de estatisticas em SVG, na mesma linguagem visual do banner.
// Uso: node scripts/stats.mjs dist/stats.svg [pt|en]

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const USER = process.env.PROFILE_USER || "TomD4vs";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = process.argv[2] || "dist/stats.svg";
const LANG = process.argv[3] === "en" ? "en" : "pt";

const T = {
  pt: {
    locale: "pt-BR",
    decimal: ",",
    repos: "REPOSITÓRIOS",
    stars: "ESTRELAS",
    followers: "SEGUIDORES",
    commits: "COMMITS (12 MESES)",
    other: "Outras",
    aria: (u) => `Estatisticas do GitHub de ${u}`,
  },
  en: {
    locale: "en-US",
    decimal: ".",
    repos: "REPOSITORIES",
    stars: "STARS",
    followers: "FOLLOWERS",
    commits: "COMMITS (12 MONTHS)",
    other: "Other",
    aria: (u) => `GitHub statistics for ${u}`,
  },
}[LANG];

const C = {
  bg: "#0C0C0D",
  value: "#EDEBE7",
  label: "#78746E",
  legend: "#A5A099",
  rule: "#232326",
  ramp: ["#D96F4B", "#B85A3B", "#96462E", "#743422", "#522417", "#33150E"],
};

const SANS = "'Segoe UI Variable Display','Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'Cascadia Code','SF Mono','JetBrains Mono',Consolas,monospace";

const fmt = new Intl.NumberFormat(T.locale);
const esc = (s) =>
  String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `${USER}-profile`,
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GET ${path} respondeu ${res.status}`);
  return res.json();
}

async function ownRepos() {
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await gh(`/users/${USER}/repos?per_page=100&page=${page}&type=owner`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all.filter((r) => !r.fork && !r.archived);
}

// Contribuicoes do ultimo ano so existem no GraphQL. Se o token nao tiver
// acesso, o card simplesmente sai com uma metrica a menos.
async function commitsLastYear() {
  if (!TOKEN) return null;
  try {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": `${USER}-profile`,
      },
      body: JSON.stringify({
        query:
          "query($login:String!){user(login:$login){contributionsCollection{totalCommitContributions}}}",
        variables: { login: USER },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.user?.contributionsCollection?.totalCommitContributions ?? null;
  } catch {
    return null;
  }
}

async function languageBytes(repos) {
  const totals = new Map();
  for (const repo of repos) {
    try {
      const langs = await gh(`/repos/${repo.full_name}/languages`);
      for (const [name, bytes] of Object.entries(langs)) {
        totals.set(name, (totals.get(name) || 0) + bytes);
      }
    } catch {
      // um repositorio inacessivel nao derruba o card inteiro
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

function render({ metrics, languages }) {
  const W = 1200;
  const H = 290;
  const M = 80;
  const inner = W - M * 2;

  const step = inner / metrics.length;
  const cells = metrics
    .map((m, i) => {
      const x = M + i * step;
      return `  <text x="${x}" y="100" font-family="${SANS}" font-size="44" font-weight="600" letter-spacing="-1" fill="${C.value}">${esc(m.value)}</text>
  <text x="${x + 2}" y="128" font-family="${MONO}" font-size="11" letter-spacing="3" fill="${C.label}">${esc(m.label)}</text>`;
    })
    .join("\n");

  const total = languages.reduce((sum, [, bytes]) => sum + bytes, 0);
  let bar = "";
  let legend = "";

  if (total > 0) {
    // Linguagens abaixo de 1% viram lascas de 1px na barra e ruido na legenda.
    const significant = languages.filter(([, bytes]) => bytes / total >= 0.01);
    const top = significant.slice(0, 5);
    const restBytes = total - top.reduce((sum, [, b]) => sum + b, 0);
    const slices = restBytes / total >= 0.01 ? [...top, [T.other, restBytes]] : top;
    const shown = slices.reduce((sum, [, b]) => sum + b, 0);

    let cursor = M;
    bar = slices
      .map(([, bytes], i) => {
        const w = (bytes / shown) * inner;
        const rect = `  <rect x="${cursor.toFixed(1)}" y="206" width="${w.toFixed(1)}" height="10" fill="${C.ramp[i]}"/>`;
        cursor += w;
        return rect;
      })
      .join("\n");

    let lx = M;
    legend = slices
      .map(([name, bytes], i) => {
        const pct = ((bytes / shown) * 100).toFixed(1).replace(".", T.decimal);
        const text = `${name} ${pct}%`;
        const width = 16 + text.length * 7.3 + 34;
        if (lx + width > W - M) return ""; // nao deixa a legenda vazar do card
        const item = `  <rect x="${lx}" y="245" width="8" height="8" fill="${C.ramp[i]}"/>
  <text x="${lx + 16}" y="253" font-family="${MONO}" font-size="12" fill="${C.legend}">${esc(text)}</text>`;
        lx += width;
        return item;
      })
      .filter(Boolean)
      .join("\n");
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(T.aria(USER))}">
  <rect width="${W}" height="${H}" fill="${C.bg}"/>

${cells}

  <line x1="${M}" y1="170" x2="${W - M}" y2="170" stroke="${C.rule}" stroke-width="1"/>

  <clipPath id="barra"><rect x="${M}" y="206" width="${inner}" height="10" rx="5"/></clipPath>
  <g clip-path="url(#barra)">
${bar}
  </g>

${legend}
</svg>
`;
}

const [user, repos, commits] = await Promise.all([
  gh(`/users/${USER}`),
  ownRepos(),
  commitsLastYear(),
]);

const languages = await languageBytes(repos);
const stars = repos.reduce((sum, r) => sum + r.stargazers_count, 0);

const metrics = [
  { value: fmt.format(repos.length), label: T.repos },
  { value: fmt.format(stars), label: T.stars },
  { value: fmt.format(user.followers), label: T.followers },
];
if (commits !== null) {
  metrics.push({ value: fmt.format(commits), label: T.commits });
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, render({ metrics, languages }), "utf8");

console.log(
  `${OUT} gerado: ${repos.length} repos, ${stars} estrelas, ${languages.length} linguagens`
);
