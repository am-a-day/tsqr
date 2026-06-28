import type { Venue } from "@/data/venues";

export type ChipFilter = "all" | "paid" | "free" | "delivery" | "pickup";

export type ExclusionReason =
  | "showOnTsqr"
  | "noBanner"
  | "noSections";

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  showOnTsqr: "Отключено отображение на tsqr.me",
  noBanner: "Нет активного баннера",
  noSections: "Нет разделов на главной",
};

/** Бизнес-правила показа витрины на tsqr.me. */
export function isEligible(v: Venue): boolean {
  return v.showOnTsqr && v.activeBannersCount > 0 && v.homeSectionsCount > 0;
}

/** Причины, по которым витрина НЕ показывается (может быть несколько). */
export function exclusionReasons(v: Venue): ExclusionReason[] {
  const reasons: ExclusionReason[] = [];
  if (!v.showOnTsqr) reasons.push("showOnTsqr");
  if (v.activeBannersCount === 0) reasons.push("noBanner");
  if (v.homeSectionsCount === 0) reasons.push("noSections");
  return reasons;
}

function matchesChip(v: Venue, chip: ChipFilter): boolean {
  switch (chip) {
    case "paid":
      return v.isPaid;
    case "free":
      return !v.isPaid;
    case "delivery":
      return v.hasDelivery;
    case "pickup":
      return v.hasPickup;
    default:
      return true;
  }
}

function matchesSearch(v: Venue, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    v.name.toLowerCase().includes(q) ||
    v.city.toLowerCase().includes(q) ||
    v.title.toLowerCase().includes(q)
  );
}

export function uniqueVenuesById(venues: Venue[]): Venue[] {
  const seen = new Set<string>();
  return venues.filter((v) => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });
}

/**
 * Возвращает витрины для показа: только подходящие по бизнес-правилам,
 * затем фильтр по чипу и поиску, отсортированные по сканам за 14 дней (убыв.).
 */
export function getVisibleVenues(
  venues: Venue[],
  chip: ChipFilter,
  search: string,
): Venue[] {
  return uniqueVenuesById(venues)
    .filter(isEligible)
    .filter((v) => matchesChip(v, chip))
    .filter((v) => matchesSearch(v, search))
    .sort((a, b) => b.scans14d - a.scans14d);
}

/** Витрины, исключённые бизнес-правилами (для дебаг-панели). */
export function getExcludedVenues(venues: Venue[]): Venue[] {
  return venues.filter((v) => !isEligible(v));
}
