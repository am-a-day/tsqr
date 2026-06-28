import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownWideNarrow,
  Check,
  Info,
  KeyRound,
  Loader2,
  QrCode,
  Radio,
  RotateCcw,
  Search,
  SearchX,
  Store,
  MapPinned,
  ScanLine,
  TriangleAlert,
} from "lucide-react";
import { VENUES, type Venue } from "@/data/venues";
import {
  fetchVenues,
  enrichVenuesTariff,
  enrichVenuesScans,
  UnauthorizedError,
} from "@/lib/api";
import { SCANS_SNAPSHOT, SCANS_SNAPSHOT_RANGE } from "@/data/scansSnapshot";
import {
  getExcludedVenues,
  getVisibleVenues,
  isEligible,
  type ChipFilter,
} from "@/lib/storefront";
import { VenueCard, type CardVariant } from "@/components/VenueCard";
import { PrototypeTools } from "@/components/PrototypeTools";
import { DebugPanel } from "@/components/DebugPanel";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const numberFmt = new Intl.NumberFormat("ru-RU");

const CHIPS: { id: ChipFilter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "paid", label: "Расширенные" },
  { id: "free", label: "Базовые" },
  { id: "delivery", label: "Есть доставка" },
  { id: "pickup", label: "Есть самовывоз" },
];

type Source = "loading" | "live" | "mock";
type ScansState = {
  mode: "snapshot" | "live";
  busy: boolean;
  progress: number;
  error: string | null;
};

const TOKEN_KEY = "tsqr_scans_token";
const VARIANT_KEY = "tsqr_card_variant";

/** Проставляет сканы из запечённого снимка (когда нет живого токена). */
function applySnapshot(venues: Venue[]) {
  for (const v of venues) {
    const s = SCANS_SNAPSHOT[v.id];
    if (s != null) v.scans14d = s;
  }
}

async function fetchStorefrontVenues() {
  const venues = await fetchVenues();
  await enrichVenuesTariff(venues);
  applySnapshot(venues);
  return venues;
}

export default function App() {
  const [chip, setChip] = useState<ChipFilter>("all");
  const [search, setSearch] = useState("");
  const [liveVenues, setLiveVenues] = useState<Venue[] | null>(null);
  const [token, setToken] = useState("");
  const autoScansTokenRef = useRef<string | null>(null);
  const [variant, setVariant] = useState<CardVariant>(
    () => {
      const saved = localStorage.getItem(VARIANT_KEY);
      return saved === "v4" || saved === "v5" || saved === "v6" ? saved : "v3";
    },
  );
  const [scans, setScans] = useState<ScansState>({
    mode: "snapshot",
    busy: false,
    progress: 0,
    error: null,
  });

  // Колонки фиксированы по 260px (макс. ширина карточки), сетка центрируется.
  const venuesQuery = useQuery({
    queryKey: ["storefrontVenues"],
    queryFn: fetchStorefrontVenues,
  });
  const baseVenues = venuesQuery.data ?? (venuesQuery.isError ? VENUES : []);
  const venues = liveVenues ?? baseVenues;
  const source: Source = venuesQuery.isPending
    ? "loading"
    : venuesQuery.isError
      ? "mock"
      : "live";

  const gridCols =
    "md:grid-cols-2 xl:grid-cols-4";

  function changeVariant(v: CardVariant) {
    setVariant(v);
    localStorage.setItem(VARIANT_KEY, v);
  }

  /** Тянет живые сканы по токену и обновляет витрины. */
  async function loadLiveScans(base: Venue[], tok: string) {
    setScans((s) => ({ ...s, busy: true, progress: 0, error: null }));
    const copy = base.map((v) => ({ ...v }));
    try {
      await enrichVenuesScans(copy, tok, (done, total) =>
        setScans((s) => ({ ...s, progress: Math.round((done / total) * 100) })),
      );
      setLiveVenues(copy);
      setScans({ mode: "live", busy: false, progress: 100, error: null });
      localStorage.setItem(TOKEN_KEY, tok);
    } catch (e) {
      localStorage.removeItem(TOKEN_KEY);
      setScans({
        mode: "snapshot",
        busy: false,
        progress: 0,
        error:
          e instanceof UnauthorizedError
            ? "Токен недействителен или истёк"
            : "Не удалось загрузить сканы",
      });
    }
  }

  useEffect(() => {
    if (!venuesQuery.isSuccess || liveVenues || !baseVenues.length) return;
    const saved = localStorage.getItem(TOKEN_KEY);
    if (!saved || autoScansTokenRef.current === saved) return;
    autoScansTokenRef.current = saved;
    setToken(saved);
    loadLiveScans(baseVenues, saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseVenues, liveVenues, venuesQuery.isSuccess]);

  const eligible = useMemo(() => venues.filter(isEligible), [venues]);
  const excluded = useMemo(() => getExcludedVenues(venues), [venues]);
  const visible = useMemo(
    () => getVisibleVenues(venues, chip, search),
    [venues, chip, search],
  );

  // Постраничный рендер: показываем по 24, догружаем при скролле
  const PAGE = 24;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setVisibleCount(PAGE), [chip, search]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visibleCount >= visible.length) return;
    const io = new IntersectionObserver(
      ([e]) => e.isIntersecting && setVisibleCount((c) => c + PAGE),
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visibleCount, visible.length]);

  const stats = useMemo(() => {
    const cities = new Set(eligible.map((v) => v.city));
    const scans = eligible.reduce((sum, v) => sum + v.scans14d, 0);
    return { venues: eligible.length, cities: cities.size, scans };
  }, [eligible]);

  return (
    <div
      className={cn(
        "min-h-screen",
        variant === "v5" || variant === "v6" ? "bg-[#f3f3ed]" : "bg-background",
      )}
    >
      {/* ===== HERO ===== */}
      <header className="relative overflow-hidden border-b border-border">
        <div
          className={cn(
            "pointer-events-none absolute inset-0",
            variant === "v5" || variant === "v6"
              ? "bg-[#f3f3ed]"
              : "bg-gradient-to-b from-accent/40 via-background to-background",
          )}
        />
        <div
          className={cn(
            "pointer-events-none absolute -top-24 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl",
            (variant === "v5" || variant === "v6") && "hidden",
          )}
        />

        <div className="relative mx-auto max-w-6xl px-4 pb-12 pt-10 sm:pt-14">
          {/* Бренд */}
          <div className="flex items-center justify-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <QrCode className="size-5" />
            </span>
            <span className="text-2xl font-extrabold tracking-tight">
              TASKO
            </span>
          </div>

          <div className="mx-auto mt-8 max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              Онлайн меню · tsqr.me
            </span>
            <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">
              Каталог онлайн-меню заведений
            </h1>
            <p className="mt-3 text-base text-muted-foreground sm:text-lg">
              Открывайте меню ресторанов, кафе и баров — без приложений,
              прямо из браузера.
            </p>
          </div>

          {/* Статистика */}
          <div className="mx-auto mt-9 grid max-w-2xl grid-cols-3 gap-3">
            <StatCard icon={Store} value={stats.venues} label="Витрин" />
            <StatCard icon={MapPinned} value={stats.cities} label="Городов" />
            <StatCard
              icon={ScanLine}
              value={stats.scans}
              label="Сканов за 14 дней"
            />
          </div>
        </div>
      </header>

      <main
        className={cn(
          "mx-auto px-4 py-8",
          variant === "v6"
            ? "max-w-[1488px]"
            : variant === "v5"
              ? "max-w-[1440px]"
              : "max-w-6xl",
        )}
      >
        {/* Источник данных */}
        <SourceBanner source={source} count={venues.length} />

        {/* Инфо-панель про правила показа */}
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-primary/20 bg-accent/40 px-5 py-4">
          <Info className="mt-0.5 size-5 shrink-0 text-primary" />
          <p className="text-sm text-foreground/80">
            Здесь показаны только активные витрины с оформленной главной: у каждой
            включён показ на tsqr.me, есть хотя бы один активный баннер и минимум
            один раздел на главной странице.
          </p>
        </div>

        {/* Токен для живых сканов */}
        <ScansTokenBar
          token={token}
          setToken={setToken}
          scans={scans}
          onApply={() => loadLiveScans(venues, token.trim())}
          onReset={() => {
            localStorage.removeItem(TOKEN_KEY);
            setToken("");
            setLiveVenues(null);
            setScans({ mode: "snapshot", busy: false, progress: 0, error: null });
          }}
        />

        {/* Панель управления: поиск, сортировка, чипы */}
        <div className="mt-6 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по названию, городу или описанию"
                className="pl-9"
              />
            </div>
            <div
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-muted-foreground"
              title="Сортировка зафиксирована для этой версии"
            >
              <ArrowDownWideNarrow className="size-4" />
              <span className="font-medium text-foreground">
                По сканам за 14 дней
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {CHIPS.map((c) => {
              const active = chip === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setChip(c.id)}
                  className={cn(
                    "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    active
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  )}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Результаты */}
        <div className="mt-5 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {source === "loading" ? (
              "Загрузка витрин…"
            ) : (
              <>Найдено: <span className="font-medium text-foreground">{visible.length}</span></>
            )}
          </p>
        </div>

        {source === "loading" ? (
          <div className={cn(
              "mt-4 grid grid-cols-1 gap-6",
              variant === "v5" || variant === "v6" ? "items-stretch" : "items-start",
              gridCols,
            )}>
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : visible.length > 0 ? (
          <>
            <div className={cn(
              "mt-4 grid grid-cols-1 gap-6",
              variant === "v5" || variant === "v6" ? "items-stretch" : "items-start",
              gridCols,
            )}>
              {visible.slice(0, visibleCount).map((venue) => (
                <VenueCard key={venue.id} venue={venue} variant={variant} />
              ))}
            </div>
            {visibleCount < visible.length && (
              <div
                ref={sentinelRef}
                className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground"
              >
                <Loader2 className="size-4 animate-spin" />
                Загрузка ещё…
              </div>
            )}
          </>
        ) : (
          <EmptyState onReset={() => { setSearch(""); setChip("all"); }} />
        )}

        {/* Дебаг-панель */}
        <div className="mt-10">
          <DebugPanel excluded={excluded} />
        </div>

        <footer className="mt-12 border-t border-border pt-6 text-center text-xs text-muted-foreground">
          Демо-интерактив tsqr.me · {numberFmt.format(stats.scans)} сканов за 14 дней
        </footer>
      </main>
      <PrototypeTools variant={variant} onChange={changeVariant} />
    </div>
  );
}

function SourceBanner({ source, count }: { source: Source; count: number }) {
  if (source === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Загружаем реальные витрины из API tasko.group…
      </div>
    );
  }
  if (source === "mock") {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-foreground/80">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        API недоступен — показаны демо-данные ({count} витрин).
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-[oklch(0.85_0.08_150)] bg-[oklch(0.97_0.03_150)] px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:gap-2">
      <span className="flex items-center gap-2 font-medium text-[oklch(0.42_0.12_150)]">
        <Radio className="size-4" />
        Реальные данные из API · {count} организаций
      </span>
      <span className="text-xs text-muted-foreground sm:ml-auto">
        Тариф, баннеры и сканы настоящие · город и доставка — демо-значения
      </span>
    </div>
  );
}

function ddmm(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}.${m}`;
}

function ScansTokenBar({
  token,
  setToken,
  scans,
  onApply,
  onReset,
}: {
  token: string;
  setToken: (v: string) => void;
  scans: ScansState;
  onApply: () => void;
  onReset: () => void;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Сканы за 14 дней</span>
        {scans.mode === "live" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[oklch(0.95_0.05_150)] px-2 py-0.5 text-xs font-medium text-[oklch(0.42_0.12_150)]">
            <Check className="size-3" /> live · обновлено
          </span>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            снимок {ddmm(SCANS_SNAPSHOT_RANGE.start)}–{ddmm(SCANS_SNAPSHOT_RANGE.end)}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Вставьте access-токен личного кабинета, чтобы подтянуть свежие сканы.
        Без токена показан запечённый снимок.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Bearer access-токен"
          disabled={scans.busy}
          className="flex-1 font-mono text-xs"
          onKeyDown={(e) => e.key === "Enter" && token.trim() && onApply()}
        />
        <button
          onClick={onApply}
          disabled={scans.busy || !token.trim()}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {scans.busy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> {scans.progress}%
            </>
          ) : (
            "Применить"
          )}
        </button>
        {scans.mode === "live" && !scans.busy && (
          <button
            onClick={onReset}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <RotateCcw className="size-4" /> Снимок
          </button>
        )}
      </div>

      {scans.busy && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${scans.progress}%` }}
          />
        </div>
      )}
      {scans.error && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
          <TriangleAlert className="size-3.5" /> {scans.error}
        </p>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="flex flex-col gap-[11px]">
      <div className="aspect-[5/6] w-full animate-pulse rounded-2xl bg-muted" />
      <div className="flex flex-col gap-2 px-1">
        <div className="h-3.5 w-full animate-pulse rounded bg-muted" />
        <div className="flex gap-[7px]">
          <div className="h-[23px] w-16 animate-pulse rounded-[7px] bg-muted" />
          <div className="h-[23px] w-20 animate-pulse rounded-[7px] bg-muted" />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Store;
  value: number;
  label: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/70 px-3 py-4 text-center backdrop-blur-sm">
      <Icon className="mx-auto size-5 text-primary" />
      <div className="mt-2 text-xl font-bold tracking-tight sm:text-2xl">
        {numberFmt.format(value)}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-16 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-card ring-1 ring-border">
        <SearchX className="size-6 text-muted-foreground" />
      </span>
      <h3 className="mt-4 text-lg font-semibold">Ничего не нашлось</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Попробуйте изменить запрос или сбросить фильтры — возможно, под выбранные
        условия пока нет витрин.
      </p>
      <button
        onClick={onReset}
        className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        Сбросить фильтры
      </button>
    </div>
  );
}
