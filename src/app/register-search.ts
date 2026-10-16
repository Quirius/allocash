import { formatDate, formatHuf } from "../lib/format";
import type {
  AccountOverview,
  AllAccountsRegisterEntry,
  CategoryOption,
  FlagOption,
  RegisterEntry,
  TransactionFormOptions,
} from "../lib/desktop";

export type SearchFilter =
  | { kind: "any" | "payee" | "category" | "memo"; query: string }
  | { kind: "account"; id: string; label: string }
  | { kind: "category-id"; id: string; label: string }
  | { kind: "category-group"; id: string; label: string }
  | { kind: "flag"; id: string; label: string };

export interface SearchSuggestion {
  key: string;
  label: string;
  fieldLabel: string;
  filter: SearchFilter;
  color?: string;
}

type SearchEntry = RegisterEntry | AllAccountsRegisterEntry;

function termsFor(query: string): string[] {
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

function containsAllTerms(value: string, terms: string[]): boolean {
  const normalized = value.toLocaleLowerCase();
  return terms.every((term) => normalized.includes(term));
}

function accountName(entry: SearchEntry, owner: AccountOverview | null): string {
  return "accountName" in entry ? entry.accountName : owner?.name ?? "";
}

function searchableValues(entry: SearchEntry, owner: AccountOverview | null): string[] {
  const amount = BigInt(entry.amount);
  return [
    accountName(entry, owner), entry.date, formatDate(entry.date), entry.payeeName ?? "",
    entry.transferAccountName ? `Transfer: ${entry.transferAccountName}` : "", entry.categoryGroupName ?? "", entry.categoryName ?? "",
    entry.memo, entry.flagName ?? "", entry.flagColor ?? "", amount.toString(), formatHuf(amount),
    amount < 0n ? (-amount).toString() : "", amount < 0n ? formatHuf(-amount) : "",
  ];
}

export function matchesRegisterSearchFilter(entry: SearchEntry, owner: AccountOverview | null, filter: SearchFilter): boolean {
  if (filter.kind === "account") {
    return "accountId" in entry ? entry.accountId === filter.id : owner?.id === filter.id;
  }
  if (filter.kind === "category-id") return entry.categoryId === filter.id;
  if (filter.kind === "category-group") return entry.categoryGroupName === filter.id;
  if (filter.kind === "flag") return entry.flagId === filter.id;

  const terms = termsFor(filter.query);
  if (!terms.length) return true;
  const values = filter.kind === "any"
    ? searchableValues(entry, owner)
    : filter.kind === "payee"
      ? [entry.payeeName ?? "", entry.transferAccountName ? `Transfer: ${entry.transferAccountName}` : ""]
      : filter.kind === "category"
        ? [entry.categoryGroupName ?? "", entry.categoryName ?? ""]
        : [entry.memo];
  return terms.every((term) => values.some((value) => value.toLocaleLowerCase().includes(term)));
}

function matchingOptions<T extends { id: string; name: string }>(items: T[], terms: string[]): T[] {
  const found = new Map<string, T>();
  for (const item of items) {
    if (containsAllTerms(item.name, terms)) found.set(item.id, item);
  }
  return [...found.values()];
}

export function buildRegisterSearchSuggestions(
  query: string,
  accounts: AccountOverview[],
  options: TransactionFormOptions,
  entries: SearchEntry[],
  allAccounts: boolean,
): SearchSuggestion[] {
  const terms = termsFor(query);
  if (!terms.length) return [];

  const suggestions: SearchSuggestion[] = [];
  if (allAccounts) {
    for (const account of matchingOptions(accounts, terms)) {
      suggestions.push({ key: `account:${account.id}`, label: account.name, fieldLabel: "Account", filter: { kind: "account", id: account.id, label: account.name } });
    }
  }

  const categories = new Map<string, CategoryOption>();
  for (const category of options.categories) categories.set(category.id, category);
  for (const entry of entries) {
    if (entry.categoryId && entry.categoryName && !categories.has(entry.categoryId)) {
      categories.set(entry.categoryId, { id: entry.categoryId, groupName: entry.categoryGroupName ?? "", name: entry.categoryName });
    }
  }
  const categoryNameCounts = new Map<string, number>();
  for (const category of categories.values()) categoryNameCounts.set(category.name, (categoryNameCounts.get(category.name) ?? 0) + 1);
  for (const category of categories.values()) {
    if (containsAllTerms(category.name, terms)) {
      const label = categoryNameCounts.get(category.name)! > 1 ? `${category.groupName} / ${category.name}` : category.name;
      suggestions.push({ key: `category:${category.id}`, label, fieldLabel: "Category", filter: { kind: "category-id", id: category.id, label } });
    } else if (containsAllTerms(`${category.groupName} ${category.name}`, terms)) {
      const label = categoryNameCounts.get(category.name)! > 1 ? `${category.groupName} / ${category.name}` : category.name;
      suggestions.push({ key: `category:${category.id}`, label, fieldLabel: "Category", filter: { kind: "category-id", id: category.id, label } });
    }
  }
  const groups = new Set<string>();
  for (const category of categories.values()) {
    if (groups.has(category.groupName) || !containsAllTerms(category.groupName, terms)) continue;
    groups.add(category.groupName);
    suggestions.push({ key: `category-group:${category.groupName}`, label: category.groupName, fieldLabel: "Category group", filter: { kind: "category-group", id: category.groupName, label: category.groupName } });
  }

  const flags = new Map<string, FlagOption>();
  for (const flag of options.flags) flags.set(flag.id, flag);
  for (const entry of entries) {
    if (entry.flagId && entry.flagName && !flags.has(entry.flagId)) {
      flags.set(entry.flagId, { id: entry.flagId, name: entry.flagName, color: entry.flagColor ?? "" });
    }
  }
  for (const flag of matchingOptions([...flags.values()], terms)) {
    suggestions.push({ key: `flag:${flag.id}`, label: flag.name, fieldLabel: "Flag", filter: { kind: "flag", id: flag.id, label: flag.name }, color: flag.color });
  }

  const searchQuery = query.trim();
  for (const [kind, target, fieldLabel] of [["any", "any field", "Any field"], ["payee", "the Payee", "Payee"], ["category", "the Category", "Category"], ["memo", "the Memo", "Memo"]] as const) {
    suggestions.push({ key: `find:${kind}`, label: `Find \u201c${searchQuery}\u201d in ${target}`, fieldLabel, filter: { kind, query: searchQuery } });
  }
  return suggestions;
}
