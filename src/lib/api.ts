import type { Venue } from "@/data/venues";

const ENDPOINT =
  "https://lk.tasko.group/be-fastapi/mvp/api/vitrine/v1/qr/orgs/qr?status=active&pageSize=300";

/** Мультиязычная строка из API. */
type Lang = Record<string, string | null | undefined>;

interface RawQr {
  status: string;
}

interface RawOrg {
  id: string;
  name: Lang;
  alias: string | null;
  description?: Lang;
  seoDescription?: Lang;
  logo: string | null;
  ogImage?: string | null;
  showOnTsqr: boolean;
  qrs?: RawQr[];
}

interface RawResponse {
  ok: boolean;
  obj: { items: RawOrg[] };
}

function pickLang(l?: Lang): string {
  if (!l) return "";
  return (l.ru || l.en || l.kk || Object.values(l).find(Boolean) || "").trim();
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(s: string, max = 70): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

/** Стабильный хеш строки (djb2) для детерминированных демо-атрибутов. */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

// ponytail: этот эндпоинт не отдаёт city/тариф/сканы/доставку — достраиваем
// детерминированно из id, чтобы прототип оставался интерактивным. В UI помечено
// как демо-данные. Заменить на реальные поля, когда появятся в API.
const DEMO_CITIES = [
  "Алматы",
  "Астана",
  "Шымкент",
  "Караганда",
  "Тараз",
  "Актобе",
  "Атырау",
];

function mapOrgToVenue(org: RawOrg): Venue {
  const h = hash(org.id);
  const alias = org.alias || org.id;
  const activeBanners = (org.qrs || []).filter((q) => q.status === "active").length;
  const desc = stripHtml(pickLang(org.description) || pickLang(org.seoDescription));

  return {
    // --- реальные поля из API ---
    id: org.id,
    name: pickLang(org.name) || "Без названия",
    title: desc ? truncate(desc) : "Онлайн-меню заведения",
    url: `${alias}.tsqr.me`,
    logo: org.logo, // настоящий URL картинки или null
    ogImage: org.ogImage ?? null, // обложка для фона платной карточки
    showOnTsqr: org.showOnTsqr,
    activeBannersCount: activeBanners,
    // ponytail: разделов главной в этом эндпоинте нет — приравниваем к активным
    // QR, чтобы правило показа (showOnTsqr && баннеры && разделы) оставалось честным.
    homeSectionsCount: activeBanners,

    // --- демо-атрибуты (нет в эндпоинте), детерминированно из id ---
    city: DEMO_CITIES[h % DEMO_CITIES.length],
    isPaid: h % 100 < 45,
    scans14d: 200 + (h % 5000),
    hasDelivery: (h & 1) === 1,
    hasPickup: (h & 2) === 2,
  };
}

const TARIFF_CATALOG =
  "https://lk.tasko.group/be-fastapi/org/api/lk/v1/tariff";
const ORG_TARIFF =
  "https://lk.tasko.group/be-fastapi/org/api/vitrine/v1/org-tariff?orgId=";

/** Набор платных типов тарифа (price > 0) из каталога. Кешируется. */
let paidTypesPromise: Promise<Set<string>> | null = null;
function fetchPaidTariffTypes(): Promise<Set<string>> {
  if (!paidTypesPromise) {
    paidTypesPromise = fetch(TARIFF_CATALOG)
      .then((r) => r.json())
      .then((d) => {
        const items: { type: string; price: number }[] = d?.obj?.items ?? [];
        return new Set(items.filter((t) => t.price > 0).map((t) => t.type));
      });
  }
  return paidTypesPromise;
}

const tariffCache = new Map<string, Promise<string | null>>();
function fetchTariffType(orgId: string): Promise<string | null> {
  const cached = tariffCache.get(orgId);
  if (cached) return cached;
  const p = fetch(ORG_TARIFF + orgId)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => d?.obj?.items?.[0]?.tariffType ?? null)
    .catch(() => null);
  tariffCache.set(orgId, p);
  return p;
}

/** Запускает fn по items с ограничением одновременных задач. */
async function pool<T>(items: T[], conc: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  const run = async () => {
    while (i < items.length) await fn(items[i++]);
  };
  await Promise.all(Array.from({ length: conc }, run));
}

/**
 * Проставляет настоящий isPaid из тарифа организации (price > 0).
 * Мутирует venues на месте. При ошибке каталога оставляет демо-значение.
 */
export async function enrichVenuesTariff(venues: Venue[]): Promise<void> {
  let paid: Set<string>;
  try {
    paid = await fetchPaidTariffTypes();
  } catch {
    return; // каталог недоступен — оставляем демо isPaid
  }
  await pool(venues, 12, async (v) => {
    const t = await fetchTariffType(v.id);
    if (t) v.isPaid = paid.has(t);
  });
}

const QR_ACTIVITY =
  "https://lk.tasko.group/be-fastapi/mvp/api/lk/v1/analytics/qr-activity-org";

/** Ошибка невалидного/просроченного токена. */
export class UnauthorizedError extends Error {}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Диапазон последних 14 дней. */
function last14Days() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 14);
  return { start: isoDate(start), end: isoDate(end) };
}

/** Сумма сканирований организации за 14 дней (требует Bearer-токен). */
async function fetchScans14d(
  orgId: string,
  token: string,
  range: { start: string; end: string },
): Promise<number | null> {
  const url = `${QR_ACTIVITY}?startDate=${range.start}&endDate=${range.end}&orgIds=${orgId}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) throw new UnauthorizedError();
  if (!r.ok) return null;
  const arr = await r.json();
  return Array.isArray(arr)
    ? arr.reduce((s: number, x) => s + (x?.count || 0), 0)
    : 0;
}

/**
 * Подтягивает реальные сканы за 14 дней по всем витринам и пишет в scans14d.
 * Бросает UnauthorizedError при плохом токене. onProgress(done, total).
 */
export async function enrichVenuesScans(
  venues: Venue[],
  token: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (!venues.length) return;
  const range = last14Days();
  // проверяем токен одним запросом, чтобы не словить 238 ошибок
  const first = await fetchScans14d(venues[0].id, token, range);
  if (first != null) venues[0].scans14d = first;
  let done = 1;
  onProgress?.(done, venues.length);
  await pool(venues.slice(1), 12, async (v) => {
    const n = await fetchScans14d(v.id, token, range);
    if (n != null) v.scans14d = n;
    onProgress?.(++done, venues.length);
  });
}

const PROMOTIONS =
  "https://lk.tasko.group/be-fastapi/org/api/vitrine/v1/promotions?orgIdOrAlias=";

const VIDEO_EXT = /\.(webm|mp4|ogv|mov)(\?|$)/i;

export interface Banner {
  url: string;
  kind: "video" | "image";
}

interface RawPromotion {
  img: string | null;
  status: string;
  sortOrder?: number;
}

// ponytail: эндпоинт баннеров — по одной организации за запрос. Кешируем промис
// по alias, чтобы фильтры/ре-рендеры не дёргали API повторно.
const bannerCache = new Map<string, Promise<Banner | null>>();

/** Первый активный баннер организации (видео или картинка). Результат кешируется. */
export function fetchBanner(alias: string): Promise<Banner | null> {
  const cached = bannerCache.get(alias);
  if (cached) return cached;

  const p = fetch(PROMOTIONS + encodeURIComponent(alias))
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const items: RawPromotion[] = data?.obj?.items ?? [];
      const first = items
        .filter((x) => x.status === "active" && x.img)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0];
      if (!first?.img) return null;
      return {
        url: first.img,
        kind: VIDEO_EXT.test(first.img) ? "video" : "image",
      } satisfies Banner;
    })
    .catch(() => null);

  bannerCache.set(alias, p);
  return p;
}

const WEB_CFG =
  "https://lk.tasko.group/be-fastapi/mvp/api/vitrine/v1/web/cfg?orgIdOrAlias=";
const RECS =
  "https://lk.tasko.group/be-fastapi/mvp/api/vitrine/v1/menu/recommendations?statusList=active&menuId=";

export interface Recommendation {
  id: string;
  name: string;
  img: string;
}

/** Глубоко ищет первый menuId в конфиге витрины (лежит в config.shortcuts[].menuId). */
function findMenuId(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === "menuId" && typeof v === "string" && v) return v;
    const nested = findMenuId(v);
    if (nested) return nested;
  }
  return null;
}

const recsCache = new Map<string, Promise<Recommendation[]>>();

/**
 * Рекомендации главной (избранные блюда) организации с фото.
 * web/cfg → menuId → menu/recommendations. Только позиции с картинкой. Кешируется.
 */
export function fetchRecommendations(alias: string): Promise<Recommendation[]> {
  const cached = recsCache.get(alias);
  if (cached) return cached;

  const p = (async () => {
    const cfg = await fetch(WEB_CFG + encodeURIComponent(alias)).then((r) =>
      r.ok ? r.json() : null,
    );
    const menuId = findMenuId(cfg?.obj);
    if (!menuId) return [];
    const rec = await fetch(RECS + menuId).then((r) => (r.ok ? r.json() : null));
    const items: { id: string; name?: Lang; img?: Record<string, string> }[] =
      rec?.obj?.items ?? [];
    return items
      .map((it) => ({
        id: it.id,
        name: pickLang(it.name),
        img: it.img?.md || it.img?.sm || it.img?.lg || "",
      }))
      .filter((r) => r.img)
      .slice(0, 8);
  })().catch(() => []);

  recsCache.set(alias, p);
  return p;
}

/** Тянет реальные витрины из API. Бросает при сетевой/HTTP ошибке. */
export async function fetchVenues(): Promise<Venue[]> {
  const res = await fetch(ENDPOINT, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as RawResponse;
  if (!data?.obj?.items) throw new Error("Unexpected response shape");
  const byId = new Map<string, RawOrg>();
  for (const org of data.obj.items) {
    if (!byId.has(org.id)) byId.set(org.id, org);
  }
  return [...byId.values()].map(mapOrgToVenue);
}
