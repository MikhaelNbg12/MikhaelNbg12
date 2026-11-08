// Gera os cards de estatísticas do perfil (SVG) a partir da API GraphQL do GitHub.
// Conta repositórios públicos e privados (se o token tiver acesso), ignorando forks.
import { mkdir, writeFile } from "node:fs/promises";

const TOKEN = process.env.STATS_TOKEN;
const LOGIN = process.env.STATS_USER || "MikhaelNbg12";
const LANGS_COUNT = Number(process.env.LANGS_COUNT || 8);
const EXCLUDE_LANGS = (process.env.EXCLUDE_LANGS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const EXCLUDE_REPOS = (process.env.EXCLUDE_REPOS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const C = { bg: "#0d1117", title: "#25f776", text: "#c9d1d9", muted: "#8b949e", track: "#21262d" };

if (!TOKEN) throw new Error("Defina o secret STATS_TOKEN (PAT com leitura dos repositórios), senão os privados não entram.");

async function gql(query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "profile-stats" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  return json.data;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (n) => new Intl.NumberFormat("pt-BR").format(n);

async function fetchRepos() {
  const repos = [];
  let after = null;
  do {
    const d = await gql(
      `query($login:String!,$after:String){ user(login:$login){ repositories(first:100, after:$after, ownerAffiliations:OWNER, isFork:false){
        pageInfo{ hasNextPage endCursor }
        nodes{ name isPrivate stargazerCount languages(first:20, orderBy:{field:SIZE, direction:DESC}){ edges{ size node{ name color } } } }
      } } }`,
      { login: LOGIN, after },
    );
    const page = d.user.repositories;
    repos.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return repos.filter((r) => !EXCLUDE_REPOS.includes(r.name.toLowerCase()));
}

async function fetchActivity() {
  const d = await gql(
    `query($login:String!){ user(login:$login){
      name
      contributionsCollection{ totalCommitContributions restrictedContributionsCount totalPullRequestContributions totalIssueContributions contributionCalendar{ totalContributions } }
      pullRequests{ totalCount }
      repositoriesContributedTo(first:1, contributionTypes:[COMMIT, PULL_REQUEST, ISSUE, REPOSITORY]){ totalCount }
    } }`,
    { login: LOGIN },
  );
  return d.user;
}

function langsCard(repos) {
  const totals = new Map();
  for (const r of repos)
    for (const e of r.languages.edges) {
      if (EXCLUDE_LANGS.includes(e.node.name.toLowerCase())) continue;
      const cur = totals.get(e.node.name) || { size: 0, color: e.node.color || C.muted };
      cur.size += e.size;
      totals.set(e.node.name, cur);
    }
  const all = [...totals.entries()].sort((a, b) => b[1].size - a[1].size);
  const sum = all.reduce((s, [, v]) => s + v.size, 0) || 1;
  const top = all.slice(0, LANGS_COUNT).map(([name, v]) => ({ name, color: v.color, pct: (v.size / sum) * 100 }));

  const W = 400, pad = 25, barW = W - pad * 2;
  const rows = Math.ceil(top.length / 2);
  const H = 90 + rows * 25;
  let x = pad;
  const bar = top
    .map((l) => {
      const w = (l.pct / 100) * barW;
      const rect = `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="8" fill="${l.color}"/>`;
      x += w;
      return rect;
    })
    .join("");
  const items = top
    .map((l, i) => {
      const cx = pad + (i % 2) * (barW / 2);
      const cy = 80 + Math.floor(i / 2) * 25;
      return `<g transform="translate(${cx},${cy})"><circle cx="5" cy="-4" r="5" fill="${l.color}"/><text x="16" y="0" class="t">${esc(l.name)} <tspan class="m">${l.pct.toFixed(2)}%</tspan></text></g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Linguagens mais usadas">
<style>.h{font:600 18px 'Segoe UI',Ubuntu,sans-serif;fill:${C.title}}.t{font:400 12px 'Segoe UI',Ubuntu,sans-serif;fill:${C.text}}.m{fill:${C.muted}}</style>
<rect width="100%" height="100%" rx="6" fill="${C.bg}"/>
<text x="${pad}" y="35" class="h">Linguagens mais usadas</text>
<clipPath id="r"><rect x="${pad}" y="0" width="${barW}" height="8" rx="4"/></clipPath>
<g transform="translate(0,50)"><rect x="${pad}" y="0" width="${barW}" height="8" rx="4" fill="${C.track}"/><g clip-path="url(#r)">${bar}</g></g>
${items}
</svg>`;
}

function statsCard(user, repos) {
  const cc = user.contributionsCollection;
  const stats = [
    ["Contribuições (último ano)", cc.contributionCalendar.totalContributions],
    ["Commits (último ano)", cc.totalCommitContributions + cc.restrictedContributionsCount],
    ["Pull requests", user.pullRequests.totalCount],
    ["Repositórios", repos.length],
    ["Contribuiu em", user.repositoriesContributedTo.totalCount],
    ["Estrelas", repos.reduce((s, r) => s + r.stargazerCount, 0)],
  ];
  const W = 400, pad = 25, H = 60 + stats.length * 25 + 10;
  const lines = stats
    .map(([k, v], i) => `<g transform="translate(${pad},${70 + i * 25})"><text class="t">${esc(k)}:</text><text x="${W - pad * 2}" text-anchor="end" class="v">${fmt(v)}</text></g>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Estatísticas do GitHub">
<style>.h{font:600 18px 'Segoe UI',Ubuntu,sans-serif;fill:${C.title}}.t{font:400 14px 'Segoe UI',Ubuntu,sans-serif;fill:${C.text}}.v{font:700 14px 'Segoe UI',Ubuntu,sans-serif;fill:${C.title}}</style>
<rect width="100%" height="100%" rx="6" fill="${C.bg}"/>
<text x="${pad}" y="35" class="h">Estatísticas do GitHub</text>
${lines}
</svg>`;
}

const [repos, user] = await Promise.all([fetchRepos(), fetchActivity()]);
await mkdir("stats", { recursive: true });
await writeFile("stats/top-langs.svg", langsCard(repos));
await writeFile("stats/overview.svg", statsCard(user, repos));
console.log(`OK: ${repos.length} repositórios (${repos.filter((r) => r.isPrivate).length} privados) analisados.`);
