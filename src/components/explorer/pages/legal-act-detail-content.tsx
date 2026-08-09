"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowLeft, Bookmark, BookmarkCheck, ChevronDown, ChevronRight, ExternalLink, ShieldAlert } from "lucide-react";

import { saveProvisionFromPayload, type SaveOutcome } from "@/app/explorer/saved/actions";
import { getLegalActStructureAction, getLegalProvisionAction } from "@/app/explorer/legal-acts/actions";
import { Modal } from "@/components/explorer/modal";
import { Panel } from "@/components/explorer/panel";
import { SectionHeader } from "@/components/section-header";
import {
  AUTHORITY_CLASS_LABELS,
  CURRENTNESS_STATUS_LABELS,
  VERSION_KIND_LABELS,
  currentnessUnprovenWarning,
  historicalPromulgatedNote,
  nonAuthoritativeWarning,
} from "@/lib/explorer/legal-acts/labels";
import { buildStructureTree, type StructureTreeNode } from "@/lib/explorer/legal-acts/structure-tree";
import type { LegalActDetail, LegalActStructureNode, LegalActVersionSummary, LegalProvisionDetail } from "@/lib/explorer/legal-acts/service";
import type { ExplorerCitedSource } from "@/lib/explorer/view-model";
import { cn } from "@/lib/utils";

interface LegalActDetailContentProps {
  act: LegalActDetail;
  initialVersionId: string | null;
  initialStructure: LegalActStructureNode[] | null;
  initialProvision: LegalProvisionDetail | null;
}

/**
 * Distinguishes multiple immutable, announcement-backed consolidated (tj) versions of the same
 * act — each gets the announcement's own ELI source id and official legalStateDate in its label,
 * so they never render as identical entries. The legacy, non-announcement-backed "tj" alias
 * (no real consolidated content) is labeled explicitly as such, never as though it were a real
 * snapshot.
 */
function versionLabel(version: LegalActVersionSummary): string {
  const base = `${VERSION_KIND_LABELS[version.versionKind]} (${version.sourceExpressionId})`;

  if (version.announcement) {
    const dateSuffix = version.legalStateDate ? `, stan na ${version.legalStateDate}` : "";
    return `${base} — ${version.announcement.sourceId}${dateSuffix}`;
  }

  if (version.versionKind === "consolidated") {
    return `${base} — nierozpoznane źródło (brak przypisanego obwieszczenia)`;
  }

  return base;
}

/** Updates the URL for deep-linking without forcing a server round trip — see milestone spec item 16 ("do not over-engineer routing"). */
function updateDeepLink(actId: string, versionId: string | null, provisionId: string | null) {
  const params = new URLSearchParams();
  if (versionId) params.set("version", versionId);
  if (provisionId) params.set("provision", provisionId);
  const query = params.toString();
  window.history.replaceState(null, "", `/explorer/legal-acts/${actId}${query ? `?${query}` : ""}`);
}

function VersionWarnings({ version }: { version: LegalActVersionSummary }) {
  if (!version.nonAuthoritative && version.currentnessStatus === "proven_current" && version.versionKind !== "promulgated") {
    return null;
  }

  return (
    <div className="space-y-1.5">
      {version.nonAuthoritative ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-300">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {nonAuthoritativeWarning()}
        </p>
      ) : null}
      {version.currentnessStatus !== "proven_current" ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-300">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {currentnessUnprovenWarning()}
        </p>
      ) : null}
      {version.versionKind === "promulgated" ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {historicalPromulgatedNote()}
        </p>
      ) : null}
    </div>
  );
}

function StructureTreeView({
  nodes,
  depth,
  expanded,
  onToggle,
  onOpen,
}: {
  nodes: StructureTreeNode[];
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <ul className={cn(depth > 0 && "ml-4 border-l border-border/60 pl-3")}>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isExpanded = expanded.has(node.id);
        return (
          <li key={node.id} className="py-0.5">
            <div className="flex items-center gap-1">
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => onToggle(node.id)}
                  aria-label={isExpanded ? "Zwiń" : "Rozwiń"}
                  className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              ) : (
                <span className="h-5 w-5 shrink-0" />
              )}
              <button
                type="button"
                onClick={() => onOpen(node.id)}
                className="truncate rounded px-1.5 py-0.5 text-left text-sm text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={node.heading ?? node.citationLabel}
              >
                {node.heading ?? node.citationLabel}
              </button>
            </div>
            {hasChildren && isExpanded ? (
              <StructureTreeView nodes={node.children} depth={depth + 1} expanded={expanded} onToggle={onToggle} onOpen={onOpen} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function saveButtonLabel(state: { kind: string; outcome?: SaveOutcome }, idleLabel: string): string {
  if (state.kind === "pending") return "Zapisywanie…";
  if (state.kind === "done" && state.outcome) {
    if (state.outcome.status === "created") return "Zapisano";
    if (state.outcome.status === "already_saved") return "Już zapisane";
    if (state.outcome.status === "quota_exceeded") return "Limit zapisanych osiągnięty";
    return "Nie udało się zapisać";
  }
  return idleLabel;
}

function SaveProvisionButton({ source }: { source: ExplorerCitedSource }) {
  const [state, setState] = useState<{ kind: "idle" | "pending" | "done"; outcome?: SaveOutcome }>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (isPending || state.kind === "pending") return;
    setState({ kind: "pending" });
    startTransition(async () => {
      const outcome = await saveProvisionFromPayload(source);
      setState({ kind: "done", outcome });
    });
  }

  const saved = state.kind === "done" && (state.outcome?.status === "created" || state.outcome?.status === "already_saved");

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending || saved}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-secondary px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-hover-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
    >
      {saved ? <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" /> : <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />}
      {saveButtonLabel(state, "Zapisz przepis")}
    </button>
  );
}

export function LegalActDetailContent({ act, initialVersionId, initialStructure, initialProvision }: LegalActDetailContentProps) {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(initialVersionId);
  const [structure, setStructure] = useState<LegalActStructureNode[] | null>(initialStructure);
  const [structureLoading, setStructureLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [provision, setProvision] = useState<LegalProvisionDetail | null>(initialProvision);
  const [provisionLoading, setProvisionLoading] = useState(false);

  const selectedVersion = act.versions.find((v) => v.id === selectedVersionId) ?? null;

  // Event-driven (not effect-driven): the version list only changes in response to a click, so
  // the fetch-and-setState happens directly in this handler rather than in a useEffect that
  // watches selectedVersionId.
  async function selectVersion(versionId: string) {
    if (versionId === selectedVersionId) return;
    setSelectedVersionId(versionId);
    setExpanded(new Set());
    updateDeepLink(act.id, versionId, null);
    setProvision(null);
    setStructureLoading(true);
    setStructure(null);
    const result = await getLegalActStructureAction(versionId);
    setStructure(result);
    setStructureLoading(false);
  }

  async function openProvision(provisionId: string) {
    if (!selectedVersionId) return;
    setProvisionLoading(true);
    try {
      const detail = await getLegalProvisionAction(selectedVersionId, provisionId);
      setProvision(detail);
      updateDeepLink(act.id, selectedVersionId, detail?.id ?? null);
    } finally {
      setProvisionLoading(false);
    }
  }

  function toggleNode(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const tree = structure ? buildStructureTree(structure) : [];

  const provisionSaveSource: ExplorerCitedSource | null =
    provision && selectedVersion
      ? {
          actTitle: act.title,
          citationLabel: provision.citationLabel,
          text: provision.text,
          isNonAuthoritative: selectedVersion.nonAuthoritative,
          isCurrentnessUnproven: selectedVersion.currentnessStatus !== "proven_current",
        }
      : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <Link
          href="/explorer/legal-acts"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Wróć do aktów prawnych
        </Link>
      </div>

      <SectionHeader
        eyebrow={act.actType}
        title={act.title}
        description={act.eliUri ? `ELI: ${act.eliUri}` : undefined}
      />

      {act.warnings.length > 0 ? (
        <Panel className="space-y-1.5 border-amber-500/30 bg-amber-500/5">
          {act.warnings.map((warning) => (
            <p key={warning} className="flex items-start gap-1.5 text-xs text-amber-300">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {warning}
            </p>
          ))}
        </Panel>
      ) : null}

      <Panel className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Wydawca</p>
          <p className="mt-1 text-sm text-foreground">{act.publisher ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Publikacja</p>
          <p className="mt-1 text-sm text-foreground">
            {act.journalYear && act.journalPosition ? `${act.journalYear}/${act.journalPosition}` : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Ogłoszenie</p>
          <p className="mt-1 text-sm text-foreground">{act.announcementDate ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Wejście w życie</p>
          <p className="mt-1 text-sm text-foreground">{act.entryIntoForceDate ?? "—"}</p>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="flex flex-col gap-4">
          <Panel>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Wersje aktu</h3>
            <div className="flex flex-col gap-1.5">
              {act.versions.map((version) => (
                <button
                  key={version.id}
                  type="button"
                  onClick={() => void selectVersion(version.id)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-xs transition",
                    version.id === selectedVersionId
                      ? "border-border bg-surface-secondary text-foreground"
                      : "border-transparent text-muted-foreground hover:border-border hover:bg-hover-surface",
                  )}
                >
                  <p className="font-medium text-foreground">{versionLabel(version)}</p>
                  <p className="mt-0.5">{AUTHORITY_CLASS_LABELS[version.authorityClass]} · {CURRENTNESS_STATUS_LABELS[version.currentnessStatus]}</p>
                  {!version.hasStructure ? <p className="mt-0.5 text-muted-foreground/80">Brak struktury</p> : null}
                </button>
              ))}
              {act.versions.length === 0 ? <p className="text-xs text-muted-foreground">Brak znanych wersji tego aktu.</p> : null}
            </div>
          </Panel>

          {selectedVersion ? (
            <Panel>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Wybrana wersja</h3>
              <VersionWarnings version={selectedVersion} />
              {selectedVersion.resources.length > 0 ? (
                <ul className="mt-3 space-y-1.5">
                  {selectedVersion.resources.map((resource) => (
                    <li key={resource.id}>
                      <a
                        href={resource.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-foreground underline decoration-border underline-offset-2 hover:text-muted-foreground"
                      >
                        {resource.representationType.toUpperCase()}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">Brak znanych zasobów dla tej wersji.</p>
              )}
            </Panel>
          ) : null}

          {act.unresolvedResources.length > 0 ? (
            <Panel>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Inne oficjalne zasoby</h3>
              <ul className="space-y-1.5">
                {act.unresolvedResources.map((resource) => (
                  <li key={resource.id}>
                    <a
                      href={resource.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-foreground underline decoration-border underline-offset-2 hover:text-muted-foreground"
                    >
                      {resource.fileName}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>

        <Panel>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Spis treści</h3>
          {structureLoading ? (
            <p className="text-sm text-muted-foreground">Wczytywanie struktury…</p>
          ) : structure === null ? (
            <p className="text-sm text-muted-foreground">Nie znaleziono wybranej wersji aktu.</p>
          ) : structure.length === 0 ? (
            <p className="text-sm text-muted-foreground">Brak dostępnej struktury aktu.</p>
          ) : (
            <StructureTreeView nodes={tree} depth={0} expanded={expanded} onToggle={toggleNode} onOpen={openProvision} />
          )}
        </Panel>
      </div>

      <Modal
        open={provision !== null || provisionLoading}
        onClose={() => setProvision(null)}
        title={provision?.citationLabel ?? "Wczytywanie…"}
        widthClassName="max-w-2xl"
      >
        {provisionLoading ? (
          <p className="text-sm text-muted-foreground">Wczytywanie przepisu…</p>
        ) : provision ? (
          <div className="space-y-4 text-sm">
            {provision.ancestors.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {provision.ancestors.map((a) => a.heading ?? a.citationLabel).join(" › ")}
              </p>
            ) : null}
            {selectedVersion ? <VersionWarnings version={selectedVersion} /> : null}
            <p className="whitespace-pre-line leading-6 text-foreground">{provision.text}</p>
            {provisionSaveSource ? (
              <div className="pt-1">
                <SaveProvisionButton source={provisionSaveSource} />
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nie znaleziono przepisu w wybranej wersji aktu.</p>
        )}
      </Modal>
    </div>
  );
}
