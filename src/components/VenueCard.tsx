import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, MapPin } from "lucide-react";
import { Diamond as Gem, Sparkle } from "@phosphor-icons/react";
import type { Venue } from "@/data/venues";
import premiumUserIcon from "@/assets/premium-user.svg";
import {
  fetchBanner,
  fetchOrgTariff,
  fetchRecommendations,
  type Banner,
  type Recommendation,
} from "@/lib/api";
import { limitCardRequest } from "@/lib/query";

export type CardVariant = "v1" | "v2" | "v3" | "v4" | "v5" | "v6";

type VideoEntry = {
  card: HTMLElement;
  video: HTMLVideoElement;
  enabled: boolean;
  hover: boolean;
};

const videoEntries = new Set<VideoEntry>();
let activeVideo: HTMLVideoElement | null = null;
let raf = 0;

function pause(video: HTMLVideoElement) {
  video.pause();
  if (activeVideo === video) activeVideo = null;
}

function playOnly(video: HTMLVideoElement) {
  if (activeVideo && activeVideo !== video) activeVideo.pause();
  activeVideo = video;
  video.play().catch(() => {});
}

function chooseVideo() {
  raf = 0;
  const center = window.innerHeight / 2;
  const visible = [...videoEntries].filter((entry) => {
    if (!entry.enabled) return false;
    const rect = entry.card.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  });
  const hovered = visible.find((e) => e.hover);
  let best = hovered ?? null;
  let bestDistance = Number.POSITIVE_INFINITY;

  if (!best) {
    for (const entry of visible) {
      const rect = entry.card.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - center);
      if (distance < bestDistance) {
        best = entry;
        bestDistance = distance;
      }
    }
  }

  for (const entry of videoEntries) {
    if (entry === best) playOnly(entry.video);
    else pause(entry.video);
  }
}

function scheduleVideoChoice() {
  if (activeVideo) pause(activeVideo);
  if (!raf) raf = window.requestAnimationFrame(chooseVideo);
}

function usePageVideo({
  cardRef,
  videoRef,
  enabled,
  inView,
  hover,
}: {
  cardRef: React.RefObject<HTMLElement>;
  videoRef: React.RefObject<HTMLVideoElement>;
  enabled: boolean;
  inView: boolean;
  hover: boolean;
}) {
  useEffect(() => {
    const card = cardRef.current;
    const video = videoRef.current;
    if (!card || !video || !enabled) return;
    const entry: VideoEntry = { card, video, enabled, hover };
    videoEntries.add(entry);
    scheduleVideoChoice();

    return () => {
      videoEntries.delete(entry);
      pause(video);
      scheduleVideoChoice();
    };
  }, [cardRef, enabled, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    const entry = [...videoEntries].find((e) => e.video === video);
    if (!entry) return;
    entry.enabled = enabled && inView;
    entry.hover = hover;
    if (!entry.enabled) pause(entry.video);
    scheduleVideoChoice();
  }, [enabled, hover, inView, videoRef]);
}

if (typeof window !== "undefined") {
  window.addEventListener("scroll", scheduleVideoChoice, { passive: true });
  window.addEventListener("resize", scheduleVideoChoice);
}

const isUrl = (s: string | null | undefined): s is string =>
  !!s && /^https?:\/\//.test(s);

/** Логотип: настоящая картинка (URL), эмодзи-заглушка или инициалы. */
export function VenueLogo({
  logo,
  name,
}: {
  logo: string | null;
  name: string;
}) {
  if (isUrl(logo)) {
    return (
      <img
        src={logo}
        alt=""
        loading="lazy"
        className="size-full object-cover"
        onError={(e) => (e.currentTarget.style.display = "none")}
      />
    );
  }
  if (logo) return <span aria-hidden>{logo}</span>;
  const initials =
    name
      .replace(/[^\p{L}\p{N} ]/gu, "")
      .trim()
      .slice(0, 1)
      .toUpperCase() || "?";
  return <span aria-hidden>{initials}</span>;
}

function aliasOf(url: string) {
  return url.replace(/\..*$/, "");
}

/** Нейтральный фон по id (когда нет фото/видео — показываем логотип на нём). */
function neutralStyle(id: string): React.CSSProperties {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return {
    backgroundImage: `linear-gradient(135deg, oklch(0.32 0.03 ${h}), oklch(0.24 0.02 ${(h + 30) % 360}))`,
  };
}

/** Переключаемая видимость в вьюпорте (для автоплея видео платных витрин). */
function useInView<T extends Element>(threshold = 0.3, rootMargin = "0px") {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), {
      rootMargin,
      threshold,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin, threshold]);
  return [ref, inView] as const;
}

function useObservedInView<T extends Element>(
  ref: React.RefObject<T>,
  threshold = 0,
  rootMargin = "0px",
) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), {
      rootMargin,
      threshold,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, threshold]);
  return inView;
}

/** Общая загрузка баннера + отслеживание видимости для карточки. */
function useResolvedVenueTariff(venue: Venue, enabled: boolean): Venue {
  const tariff = useQuery({
    queryKey: ["orgTariff", venue.id],
    queryFn: () => limitCardRequest(() => fetchOrgTariff(venue.id)),
    enabled,
  });

  return {
    ...venue,
    isPaid: tariff.data?.isPaid === true,
  };
}

function useVenueMedia(venue: Venue) {
  const [ref, inView] = useInView<HTMLAnchorElement>();
  const shouldLoad = useObservedInView(ref, 0, "900px");
  const resolvedVenue = useResolvedVenueTariff(venue, shouldLoad);
  const alias = aliasOf(venue.url);
  const banner = useQuery({
    queryKey: ["venueBanner", alias],
    queryFn: () => limitCardRequest(() => fetchBanner(alias)),
    enabled: shouldLoad && resolvedVenue.isPaid,
  });
  return {
    ref,
    inView,
    shouldLoad,
    venue: resolvedVenue,
    banner: banner.data ?? null,
  };
}

function useVenueRecommendations(venue: Venue, enabled: boolean) {
  const alias = aliasOf(venue.url);
  const recs = useQuery({
    queryKey: ["venueRecommendations", alias],
    queryFn: () => limitCardRequest(() => fetchRecommendations(alias)),
    enabled: enabled && venue.isPaid,
  });
  return recs.data ?? [];
}

/**
 * Hero-медиа: первое промо-фото, либо видео (платным autoplay в зоне видимости,
 * бесплатным постер), либо логотип на нейтральном фоне, если промо нет.
 */
function CardMedia({
  venue,
  banner,
  inView,
  cardRef,
}: {
  venue: Venue;
  banner: Banner | null;
  inView: boolean;
  cardRef: React.RefObject<HTMLElement>;
}) {
  const vidRef = useRef<HTMLVideoElement>(null);
  const [hover, setHover] = useState(false);
  const canPlayVideo = banner?.kind === "video" && venue.isPaid;
  usePageVideo({
    cardRef,
    videoRef: vidRef,
    enabled: canPlayVideo,
    inView,
    hover,
  });

  const kenBurns =
    "size-full object-cover transition-transform duration-[5000ms] ease-out group-hover:scale-110";

  if (banner?.kind === "image") {
    return (
      <img
        src={banner.url}
        alt=""
        loading="lazy"
        className={kenBurns}
        onError={(e) => (e.currentTarget.style.display = "none")}
      />
    );
  }

  if (banner?.kind === "video") {
    return (
      <video
        ref={vidRef}
        // #t=0.1 даёт кадр-постер; play() включается только для активной расширенной карточки.
        src={`${banner.url}#t=0.1`}
        muted
        loop
        playsInline
        preload="metadata"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
      />
    );
  }

  return (
    <div
      className="flex size-full items-center justify-center"
      style={neutralStyle(venue.id)}
    >
      <span className="flex size-16 items-center justify-center overflow-hidden rounded-2xl bg-white/90 text-2xl font-semibold text-foreground ring-1 ring-white/30">
        <VenueLogo logo={venue.logo} name={venue.name} />
      </span>
    </div>
  );
}

/** Sparkle «расширенная витрина» — только у платных, поверх медиа. */
function GemBadge() {
  return (
    <span
      title="Расширенная витрина"
      aria-label="Расширенная витрина"
      className="absolute right-2.5 top-2.5 z-10 flex size-8 items-center justify-center rounded-full bg-white/15 backdrop-blur-md"
    >
      <Sparkle size={18} weight="fill" className="text-white" />
    </span>
  );
}

export function VenueCard({
  venue,
  variant,
}: {
  venue: Venue;
  variant: CardVariant;
}) {
  if (variant === "v6") return <VenueCardV6 venue={venue} />;
  if (variant === "v5") return <VenueCardV5 venue={venue} />;
  if (variant === "v4") return <VenueCardV4 venue={venue} />;
  if (variant === "v3") return <VenueCardV3 venue={venue} />;
  if (variant === "v2") return <VenueCardV2 venue={venue} />;
  return <VenueCardV1 venue={venue} />;
}

/* ───────────────── Вариант 1 (зафиксирован): текст поверх фото ───────────────── */

function serviceLabels(venue: Venue): string[] {
  return [
    venue.hasDelivery && "Доставка",
    venue.hasPickup && "Самовывоз",
  ].filter(Boolean) as string[];
}

function ChipsV1({ venue }: { venue: Venue }) {
  const labels = serviceLabels(venue);
  if (labels.length === 0) return null; // нет способов — не рендерим ряд
  return (
    <div className="flex flex-wrap items-center gap-[7px]">
      {labels.map((label) => (
        <span
          key={label}
          className="inline-flex h-[23px] items-center rounded-[7px] border border-[#e7e5e4] px-2.5 text-[11px] font-medium text-[#44403b]"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function VenueCardV1({ venue }: { venue: Venue }) {
  const href = `https://${venue.url}`;
  const {
    ref,
    inView,
    banner,
    venue: resolvedVenue,
  } = useVenueMedia(venue);

  return (
    <a
      ref={ref}
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col gap-[11px] outline-none transition-transform duration-300 hover:-translate-y-1 focus-visible:-translate-y-1"
    >
      <div className="relative aspect-[5/6] w-full overflow-hidden rounded-2xl bg-muted shadow-sm ring-1 ring-black/5 transition-shadow duration-300 group-hover:shadow-xl group-focus-visible:ring-2 group-focus-visible:ring-ring/60">
        <CardMedia
          venue={resolvedVenue}
          banner={banner}
          inView={inView}
          cardRef={ref}
        />
        {resolvedVenue.isPaid && <GemBadge />}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pb-3 pt-9 backdrop-blur-[2px]">
          <span className="absolute -top-5 left-3 flex size-9 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-white text-sm font-semibold text-foreground shadow-md">
            <VenueLogo logo={venue.logo} name={venue.name} />
          </span>
          <h3 className="text-[17px] font-semibold leading-tight text-white">
            {venue.name}
          </h3>
          {venue.city && (
            <p className="mt-0.5 flex items-center gap-1 text-sm font-medium text-white/75">
              <MapPin className="size-3.5 shrink-0" />
              {venue.city}
            </p>
          )}
        </div>
      </div>

      {(venue.title || serviceLabels(venue).length > 0) && (
        <div className="flex flex-col gap-[9px] px-1">
          {venue.title && (
            <p className="line-clamp-2 text-sm text-[#79716b]">{venue.title}</p>
          )}
          <ChipsV1 venue={venue} />
        </div>
      )}
    </a>
  );
}

/* ──────────── Вариант 2: текст под фото, пустые поля скрыты и поджаты ──────────── */

function ChipsV2({ venue }: { venue: Venue }) {
  const labels = [
    venue.hasDelivery && "Доставка",
    venue.hasPickup && "Самовывоз",
  ].filter(Boolean) as string[];
  if (labels.length === 0) return null; // нет способов — не показываем ряд
  return (
    <div className="flex flex-wrap items-center gap-[7px]">
      {labels.map((label) => (
        <span
          key={label}
          className="inline-flex h-[23px] items-center rounded-[7px] bg-[#f5f5f4] px-2.5 text-[11px] font-medium text-[#292524]"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function VenueCardV2({ venue }: { venue: Venue }) {
  const href = `https://${venue.url}`;
  const {
    ref,
    inView,
    banner,
    venue: resolvedVenue,
  } = useVenueMedia(venue);

  return (
    <a
      ref={ref}
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col gap-[11px] outline-none transition-transform duration-300 hover:-translate-y-1 focus-visible:-translate-y-1"
    >
      <div className="relative aspect-[5/6] w-full overflow-hidden rounded-[19px] bg-muted shadow-sm ring-1 ring-black/5 transition-shadow duration-300 group-hover:shadow-xl group-focus-visible:ring-2 group-focus-visible:ring-ring/60">
        <CardMedia
          venue={resolvedVenue}
          banner={banner}
          inView={inView}
          cardRef={ref}
        />
        {resolvedVenue.isPaid && <GemBadge />}
      </div>

      {/* Всё под фото; пустые поля скрыты, контент поджат к верху */}
      <div className="flex flex-col items-start gap-[9px]">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-lg font-semibold leading-tight text-[#292524]">
            {venue.name}
          </h3>
          {venue.city && (
            <p className="flex items-center gap-1 text-sm font-medium text-[#57534d] opacity-75">
              <MapPin className="size-3.5 shrink-0" />
              {venue.city}
            </p>
          )}
        </div>

        {venue.title && (
          <p className="line-clamp-2 text-sm text-[#79716b]">{venue.title}</p>
        )}

        <ChipsV2 venue={venue} />
      </div>
    </a>
  );
}

/* ─── Вариант 3: рекомендации встроены в hero media ─── */

/** Gem рядом с названием (amber-квадрат с белым Diamond). Только расширенные. */
function GemInline() {
  return (
    <span
      title="Расширенная витрина"
      aria-label="Расширенная витрина"
      className="flex size-[15px] shrink-0 items-center justify-center rounded-[5px] bg-[#fe9a00]"
    >
      <Gem size={10} weight="fill" className="text-white" />
    </span>
  );
}

function ChipsV3({ labels }: { labels: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-[7px]">
      {labels.map((label) => (
        <span
          key={label}
          className="inline-flex h-[23px] items-center rounded-[7px] bg-[#fffbeb] px-2.5 text-[11px] font-semibold text-[#fe9a00]"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

/** Тело карточки V3: название+gem, город (текстом), title, amber-чипы. */
function BodyV3({ venue }: { venue: Venue }) {
  const labels = serviceLabels(venue);
  return (
    <div className="flex flex-col items-start gap-[9px]">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <h3 className="text-lg font-semibold leading-tight text-[#292524]">
            {venue.name}
          </h3>
          {venue.isPaid && <GemInline />}
        </div>
        {venue.city && (
          <p className="text-sm font-medium text-[#57534d] opacity-75">
            {venue.city}
          </p>
        )}
      </div>
      {venue.title && (
        <p className="line-clamp-2 text-sm text-[#79716b]">{venue.title}</p>
      )}
      {labels.length > 0 && <ChipsV3 labels={labels} />}
    </div>
  );
}

function DesktopHeroCta({ raised = false }: { raised?: boolean }) {
  return (
    <span
      className={
        "pointer-events-none absolute inset-x-4 z-20 hidden h-10 items-center justify-center rounded-full bg-white text-sm font-semibold text-[#292524] opacity-0 shadow-lg ring-1 ring-black/5 transition-all duration-200 group-hover:-translate-y-1 group-hover:opacity-100 group-focus-visible:-translate-y-1 group-focus-visible:opacity-100 md:flex " +
        (raised ? "bottom-28" : "bottom-5")
      }
    >
      Открыть меню
    </span>
  );
}

type Thumb = { kind: "video" | "image"; src: string; key: string };

/** Hero V3: рекомендации встроены в нижнюю часть фотографии. */
function HeroMediaV3({
  venue,
  banner,
  recs,
  inView,
  cardRef,
}: {
  venue: Venue;
  banner: Banner | null;
  recs: Recommendation[] | null;
  inView: boolean;
  cardRef: React.RefObject<HTMLElement>;
}) {
  const [overlaySrc, setOverlaySrc] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  const vidRef = useRef<HTMLVideoElement>(null);

  const isVideo = banner?.kind === "video";
  const baseImg = banner?.kind === "image" ? banner.url : null;
  const [activeKey, setActiveKey] = useState<string>(
    isVideo ? "promo-video" : "",
  );

  usePageVideo({
    cardRef,
    videoRef: vidRef,
    enabled: isVideo && venue.isPaid && !overlaySrc,
    inView,
    hover,
  });

  const recThumbs: Thumb[] = (recs || [])
    .slice(0, 3)
    .map((r) => ({ kind: "image", src: r.img, key: r.id }));
  const thumbs: Thumb[] =
    isVideo && venue.isPaid && banner
      ? [{ kind: "video", src: banner.url, key: "promo-video" }, ...recThumbs]
      : recThumbs;

  const enter = (t: Thumb) => {
    setActiveKey(t.key);
    setOverlaySrc(t.kind === "image" ? t.src : null);
    setHover(t.kind === "video");
  };

  const leave = () => {
    setActiveKey(isVideo ? "promo-video" : "");
    setOverlaySrc(null);
    setHover(false);
  };

  return (
    <div
      onMouseLeave={leave}
      className="relative aspect-[5/6] w-full overflow-hidden rounded-[23px] bg-muted shadow-sm ring-1 ring-black/5 transition-shadow duration-300 group-hover:shadow-xl group-focus-visible:ring-2 group-focus-visible:ring-ring/60"
    >
      {isVideo ? (
        <video
          ref={vidRef}
          src={`${banner!.url}#t=0.1`}
          muted
          loop
          playsInline
          preload="metadata"
          className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
        />
      ) : baseImg ? (
        <img
          src={baseImg}
          alt=""
          loading="lazy"
          className="size-full object-cover transition-transform duration-[5000ms] ease-out group-hover:scale-110"
        />
      ) : (
        <div
          className="flex size-full items-center justify-center"
          style={neutralStyle(venue.id)}
        >
          <span className="flex size-16 items-center justify-center overflow-hidden rounded-2xl bg-white/90 text-2xl font-semibold text-foreground ring-1 ring-white/30">
            <VenueLogo logo={venue.logo} name={venue.name} />
          </span>
        </div>
      )}
      <img
        src={overlaySrc ?? ""}
        alt=""
        className="pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-300"
        style={{ opacity: overlaySrc ? 1 : 0 }}
      />

      {thumbs.length > 0 && (
        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/65 via-black/30 to-transparent px-3 pb-3 pt-10">
          <div
            className="flex snap-x snap-mandatory gap-1.5 overflow-x-auto overscroll-x-contain scroll-smooth pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:overflow-hidden"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            {thumbs.map((t) => (
              <div
                key={t.key}
                onMouseEnter={() => enter(t)}
                onTouchStart={() => enter(t)}
                className={
                  "relative aspect-[5/4] w-[76px] shrink-0 snap-start overflow-hidden rounded-[13px] bg-black/20 shadow-md outline-none ring-1 ring-white/25 transition-all hover:-translate-y-0.5 hover:ring-2 hover:ring-white focus-visible:ring-2 focus-visible:ring-white sm:min-w-0 sm:flex-1 sm:shrink sm:basis-0 " +
                  (activeKey === t.key ? "ring-2 ring-[#fe9a00]" : "")
                }
                aria-label="Миниатюра рекомендации"
              >
                {t.kind === "video" ? (
                  <video
                    src={`${t.src}#t=0.1`}
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    className="size-full object-cover"
                  />
                ) : (
                  <img
                    src={t.src}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <DesktopHeroCta raised={thumbs.length > 0} />
    </div>
  );
}

function VenueCardV3({ venue }: { venue: Venue }) {
  const {
    ref,
    inView,
    shouldLoad,
    banner,
    venue: resolvedVenue,
  } = useVenueMedia(venue);
  const recs = useVenueRecommendations(resolvedVenue, shouldLoad);

  const showRecommendations = resolvedVenue.isPaid && (recs?.length ?? 0) > 0;

  return (
    <a
      ref={ref}
      href={`https://${venue.url}`}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col gap-[11px] outline-none transition-transform duration-300 hover:-translate-y-1 focus-visible:-translate-y-1"
    >
      <HeroMediaV3
        venue={resolvedVenue}
        banner={banner}
        recs={showRecommendations ? recs : []}
        inView={inView}
        cardRef={ref}
      />
      <BodyV3 venue={resolvedVenue} />
    </a>
  );
}

type Slide = {
  kind: "video" | "image" | "fallback";
  src?: string;
  key: string;
};

function HeroMediaV4({
  venue,
  banner,
  recs,
  inView,
  cardRef,
}: {
  venue: Venue;
  banner: Banner | null;
  recs: Recommendation[] | null;
  inView: boolean;
  cardRef: React.RefObject<HTMLElement>;
}) {
  const [active, setActive] = useState(0);
  const vidRef = useRef<HTMLVideoElement>(null);

  const slides: Slide[] = [];
  if (banner) slides.push({ kind: banner.kind, src: banner.url, key: "promo" });
  else slides.push({ kind: "fallback", key: "fallback" });
  if (venue.isPaid) {
    for (const r of (recs || []).slice(0, 3)) {
      slides.push({ kind: "image", src: r.img, key: r.id });
    }
  }

  const activeSlide = slides[active] || null;
  const promo = slides[0] || null;
  const overlayImage =
    activeSlide?.kind === "image" &&
    activeSlide.src &&
    activeSlide.src !== promo?.src
      ? activeSlide.src
      : null;
  const hasZones = venue.isPaid && slides.length > 1;

  usePageVideo({
    cardRef,
    videoRef: vidRef,
    enabled: activeSlide?.kind === "video" && venue.isPaid,
    inView,
    hover: activeSlide?.kind === "video",
  });

  const reset = () => setActive(0);

  return (
    <div
      onMouseLeave={reset}
      className="relative aspect-[5/6] w-full overflow-hidden rounded-[23px] bg-muted shadow-sm ring-1 ring-black/5 transition-shadow duration-300 group-hover:shadow-xl group-focus-visible:ring-2 group-focus-visible:ring-ring/60"
    >
      {promo?.kind === "video" && promo.src ? (
        <video
          ref={vidRef}
          src={`${promo.src}#t=0.1`}
          muted
          loop
          playsInline
          preload="metadata"
          className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
        />
      ) : promo?.kind === "image" && promo.src ? (
        <img
          src={promo.src}
          alt=""
          loading="lazy"
          className="size-full object-cover transition-transform duration-[5000ms] ease-out group-hover:scale-110"
        />
      ) : (
        <div
          className="flex size-full items-center justify-center"
          style={neutralStyle(venue.id)}
        >
          <span className="flex size-16 items-center justify-center overflow-hidden rounded-2xl bg-white/90 text-2xl font-semibold text-foreground ring-1 ring-white/30">
            <VenueLogo logo={venue.logo} name={venue.name} />
          </span>
        </div>
      )}

      <img
        src={overlayImage ?? ""}
        alt=""
        className="pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-200"
        style={{ opacity: overlayImage ? 1 : 0 }}
      />

      <DesktopHeroCta />

      {hasZones && (
        <>
          <div className="absolute inset-x-3 top-3 z-10 flex gap-1.5">
            {slides.map((s, i) => (
              <span
                key={s.key}
                className={
                  "h-1 flex-1 rounded-full transition-colors " +
                  (i === active ? "bg-white" : "bg-white/35")
                }
              />
            ))}
          </div>
          <div className="absolute inset-0 z-10 flex">
            {slides.map((s, i) => (
              <div
                key={s.key}
                className="min-w-0 flex-1"
                onMouseEnter={() => setActive(i)}
                aria-label={`Слайд ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function VenueCardV4({ venue }: { venue: Venue }) {
  const {
    ref,
    inView,
    shouldLoad,
    banner,
    venue: resolvedVenue,
  } = useVenueMedia(venue);
  const recs = useVenueRecommendations(resolvedVenue, shouldLoad);

  return (
    <a
      ref={ref}
      href={`https://${venue.url}`}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col gap-[11px] outline-none transition-transform duration-300 hover:-translate-y-1 focus-visible:-translate-y-1"
    >
      <HeroMediaV4
        venue={resolvedVenue}
        banner={banner}
        recs={recs}
        inView={inView}
        cardRef={ref}
      />
      <BodyV3 venue={resolvedVenue} />
    </a>
  );
}

function serviceText(venue: Venue) {
  const labels = serviceLabels(venue);
  if (labels.length === 2) return "Доставка и самовывоз";
  return labels[0] ?? "";
}

function VenueCardV5({ venue }: { venue: Venue }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const shouldLoad = useObservedInView(ref, 0, "900px");
  const resolvedVenue = useResolvedVenueTariff(venue, shouldLoad);
  const services = serviceText(resolvedVenue);

  return (
    <a
      ref={ref}
      href={`https://${venue.url}`}
      target="_blank"
      rel="noreferrer"
      className={
        "group relative flex h-full min-h-[169px] flex-col items-start justify-center overflow-hidden rounded-[23px] border-[3px] border-white p-4 outline-none backdrop-blur-[19.984px] transition-all duration-300 hover:-translate-y-1 focus-visible:-translate-y-1 focus-visible:ring-2 focus-visible:ring-ring/60 " +
        (resolvedVenue.isPaid ? "gap-3 bg-white" : "bg-[#faf8f4]")
      }
    >
      {resolvedVenue.isPaid && (
        <>
          <span
            className="pointer-events-none absolute left-[-10px] top-[94px] z-0 h-[71px] w-[341px] rounded-full opacity-100 blur-2xl transition-opacity duration-300 group-hover:opacity-0 group-focus-visible:opacity-0"
            style={{
              background:
                "radial-gradient(ellipse at center, rgba(217,119,87,0.16) 0%, rgba(248,221,196,0.68) 44%, rgba(255,255,255,0) 76%)",
            }}
          />
          <span
            className="pointer-events-none absolute left-[-10px] top-[54px] z-0 h-[71px] w-[341px] rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100"
            style={{
              background:
                "radial-gradient(ellipse at center, rgba(232,84,35,0.20) 0%, rgba(248,221,196,0.74) 44%, rgba(255,255,255,0) 76%)",
            }}
          />
        </>
      )}

      {resolvedVenue.isPaid && (
        <span className="pointer-events-none absolute right-4 top-[13px] z-20 flex h-[26px] items-center justify-center gap-1 rounded-[9px] border border-[#d6d3d1] bg-white px-1.5 text-sm font-normal leading-none text-[#292524] opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
          Открыть меню
          <ExternalLink className="size-4" strokeWidth={1.8} />
        </span>
      )}

      <div className="relative z-10 flex w-full flex-col items-start gap-1">
        <span
          className={
            "flex shrink-0 items-center justify-center rounded-full p-1 transition-colors duration-200 " +
            (resolvedVenue.isPaid
              ? "border border-[rgba(217,119,87,0.5)] group-hover:border-[#e85423] group-focus-visible:border-[#e85423]"
              : "")
          }
        >
          <span className="flex size-[38px] items-center justify-center overflow-hidden rounded-full bg-[#292524] text-[10px] font-bold leading-none text-white">
            <VenueLogo logo={resolvedVenue.logo} name={resolvedVenue.name} />
          </span>
        </span>

        <div className="flex w-full flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1">
            <h3 className="line-clamp-2 min-w-0 text-lg font-semibold leading-tight text-[#292524]">
              {resolvedVenue.name}
            </h3>
            {resolvedVenue.isPaid && (
              <span
                title="Расширенная витрина"
                aria-label="Расширенная витрина"
                className="flex size-[14px] shrink-0 items-center justify-center rounded-full bg-[#e85423]"
              >
                <Gem size={10} weight="fill" className="text-white" />
              </span>
            )}
          </div>

          {(resolvedVenue.city || services) && (
            <div className="flex max-w-full items-center gap-[5px] overflow-hidden text-sm leading-normal">
              {resolvedVenue.city && (
                <span className="shrink-0 font-medium text-[#79716b]">
                  {resolvedVenue.city}
                </span>
              )}
              {resolvedVenue.city && services && (
                <span className="shrink-0 text-[8px] text-[#79716b]">•</span>
              )}
              {services && (
                <span className="truncate font-medium text-[#44403b]">
                  {services}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {resolvedVenue.title && (
        <p
          className={
            "relative line-clamp-2 text-sm leading-normal text-[#44403b] " +
            (!resolvedVenue.isPaid ? "hidden" : "")
          }
        >
          {resolvedVenue.title}
        </p>
      )}
    </a>
  );
}

function DLogo({ venue, className = "" }: { venue: Venue; className?: string }) {
  return (
    <span
      className={
        "flex size-[38px] items-center justify-center overflow-hidden rounded-full border-[1.4px] border-white bg-white p-[3.3px] shadow-[0_7px_18px_rgba(41,37,36,0.14)] " +
        className
      }
    >
      <span className="flex size-full items-center justify-center overflow-hidden rounded-full bg-[#292524] text-[10px] font-bold leading-none text-white">
        <VenueLogo logo={venue.logo} name={venue.name} />
      </span>
    </span>
  );
}

function DMediaTile({
  banner,
  src,
  venue,
}: {
  banner?: Banner | null;
  src?: string;
  venue: Venue;
}) {
  const mediaSrc = src ?? banner?.url ?? null;
  const cls = "size-full object-cover";

  if (banner?.kind === "video" && !src) {
    return (
      <video
        src={`${banner.url}#t=0.1`}
        muted
        playsInline
        preload="metadata"
        className={cls}
      />
    );
  }

  if (mediaSrc) {
    return <img src={mediaSrc} alt="" loading="lazy" className={cls} />;
  }

  return (
    <div
      className="flex size-full items-center justify-center"
      style={neutralStyle(venue.id)}
    >
      <VenueLogo logo={venue.logo} name={venue.name} />
    </div>
  );
}

function PreviewD({
  venue,
  banner,
  recs,
}: {
  venue: Venue;
  banner: Banner | null;
  recs: Recommendation[] | null;
}) {
  const shown = (recs || []).slice(0, 2);
  return (
    <div className="relative z-10 flex h-[73px] w-full shrink-0 gap-0.5 overflow-hidden rounded-[14px]">
      <div
        className={
          "h-[73px] overflow-hidden rounded-[3px] " +
          (shown.length > 0 ? "w-[51%] shrink-0" : "w-full")
        }
      >
        <DMediaTile venue={venue} banner={banner} />
      </div>
      {shown.map((r) => (
        <div key={r.id} className="min-w-0 flex-1 overflow-hidden rounded-[3px]">
          <DMediaTile venue={venue} src={r.img} />
        </div>
      ))}
    </div>
  );
}

function BrandPreviewD({ venue }: { venue: Venue }) {
  return (
    <div
      className="relative z-10 h-[73px] w-full shrink-0 overflow-hidden rounded-[14px]"
      style={{
        background:
          "linear-gradient(103deg, #f6ecd8 0%, #f3f3ed 52%, #edf2e7 100%)",
      }}
    >
      <span
        className="pointer-events-none absolute -left-3 -top-2 h-[78px] w-[96px] rounded-full opacity-50 blur-2xl"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(232,84,35,0.18) 0%, rgba(248,221,196,0.46) 52%, rgba(255,255,255,0) 78%)",
        }}
      />
      {isUrl(venue.logo) ? (
        <img
          src={venue.logo}
          alt=""
          loading="lazy"
          className="absolute inset-x-0 bottom-[-24px] mx-auto size-24 object-contain opacity-[0.07] blur-[1px]"
        />
      ) : (
        <span className="absolute inset-x-0 bottom-[-18px] flex justify-center text-5xl opacity-[0.07] blur-[1px]">
          {venue.logo}
        </span>
      )}
    </div>
  );
}

function BodyD({ venue }: { venue: Venue }) {
  const hasOnlineOrder = venue.hasDelivery || venue.hasPickup;
  return (
    <div className="relative z-10 flex w-full min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 items-center gap-1">
        <h3 className="line-clamp-1 min-w-0 text-lg font-semibold leading-tight text-[#292524]">
          {venue.name}
        </h3>
        {venue.isPaid && (
          <span
            title="Расширенная витрина"
            aria-label="Расширенная витрина"
            className="flex size-[18px] shrink-0 items-center justify-center"
          >
            <img src={premiumUserIcon} alt="" className="size-[18px]" />
          </span>
        )}
      </div>
      {(venue.city || hasOnlineOrder) && (
        <div className="flex max-w-full items-center gap-[5px] overflow-hidden text-sm leading-normal">
          {venue.city && (
            <span className="shrink-0 font-medium text-[#79716b]">
              {venue.city}
            </span>
          )}
          {venue.city && hasOnlineOrder && (
            <span className="shrink-0 text-[8px] text-[#79716b]">•</span>
          )}
          {hasOnlineOrder && (
            <span className="truncate font-medium text-[#096]">
              Онлайн заказ
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function VenueCardV6({ venue }: { venue: Venue }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const shouldLoad = useObservedInView(ref, 0, "900px");
  const resolvedVenue = useResolvedVenueTariff(venue, shouldLoad);
  const alias = aliasOf(venue.url);
  const banner = useQuery({
    queryKey: ["venueBanner", alias],
    queryFn: () => limitCardRequest(() => fetchBanner(alias)),
    enabled: shouldLoad && resolvedVenue.isPaid,
  });
  const recs = useVenueRecommendations(resolvedVenue, shouldLoad);

  return (
    <a
      ref={ref}
      href={`https://${venue.url}`}
      target="_blank"
      rel="noreferrer"
      className="group relative flex h-[199px] flex-col items-start gap-3 overflow-hidden rounded-[23px] border-[3px] border-white bg-white pb-4 pl-2 pr-4 pt-2 outline-none backdrop-blur-[19.984px] focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      {resolvedVenue.isPaid ? (
        <PreviewD venue={resolvedVenue} banner={banner.data ?? null} recs={recs} />
      ) : (
        <BrandPreviewD venue={resolvedVenue} />
      )}

      <DLogo venue={resolvedVenue} className="absolute left-[16px] top-[54px] z-20" />

      <div className="relative z-10 flex w-full min-w-0 flex-col gap-3 pl-0">
        <BodyD venue={resolvedVenue} />

        {resolvedVenue.title && (
          <p className="line-clamp-2 max-w-[239px] text-sm leading-normal text-[#44403b]">
            {resolvedVenue.title}
          </p>
        )}
      </div>
    </a>
  );
}
