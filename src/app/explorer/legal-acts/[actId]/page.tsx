import { notFound } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { LegalActDetailContent } from "@/components/explorer/pages/legal-act-detail-content";
import { getDb } from "@/db";
import { getLegalAct, getLegalActStructure, getLegalProvision } from "@/lib/explorer/legal-acts/service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PageProps {
  params: Promise<{ actId: string }>;
  searchParams: Promise<{ version?: string; provision?: string }>;
}

export default async function ExplorerLegalActDetailPage({ params, searchParams }: PageProps) {
  const { actId } = await params;
  if (!UUID_PATTERN.test(actId)) {
    notFound();
  }

  const db = getDb();
  const act = await getLegalAct({ db, id: actId });
  if (!act) {
    notFound();
  }

  const { version, provision } = await searchParams;
  const requestedVersionId = version && act.versions.some((v) => v.id === version) ? version : null;
  const initialVersionId = requestedVersionId ?? act.defaultVersionId;

  const initialStructure = initialVersionId ? await getLegalActStructure({ db, legalActVersionId: initialVersionId }) : null;
  const initialProvision =
    provision && initialVersionId ? await getLegalProvision({ db, legalActVersionId: initialVersionId, provisionId: provision }) : null;

  return (
    <AppShell>
      <LegalActDetailContent
        act={act}
        initialVersionId={initialVersionId}
        initialStructure={initialStructure}
        initialProvision={initialProvision}
      />
    </AppShell>
  );
}
