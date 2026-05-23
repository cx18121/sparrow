// Barrel re-export for the dossier pipelines. The implementation was
// split into ./dossier/ on 2026-05-23 — five focused modules instead of
// one 1300-line file. This barrel preserves the existing import path so
// consumers (server/lib/draft-generation.ts, server/routes/emails/
// angle.ts, server/routes/preview-fit-angle.ts, scripts/*) don't need
// to update.
//
// Layout:
//   dossier/shared.ts    — SYNTH_MODEL, ResearchCompanyInput, parseDossierJson,
//                          stripCitations, cleanList, parseLine, dedupeByUrl
//   dossier/eng.ts       — engineering / product pipeline (CompanyDossier,
//                          research*, pickFitAngle)
//   dossier/gtm.ts       — GTM pipeline (GtmDossier, research*, pickGtmAngle)
//   dossier/ops.ts       — operations pipeline (OpsDossier, research*, pickOpsAngle)
//   dossier/envelope.ts  — multi-role cache (DossierEnvelope, CachedRoleSlot,
//                          parseCachedDossierEnvelope, get/setDossierSlot)
//
// The parseXDossierFromText triplet that this file used to carry was
// also collapsed into a single parseDossierJson<T> helper in shared.ts.

export {
  // engineering / product
  isEmptyDossier,
  parseFlatDossier,
  synthesizeDossier,
  researchCompanyDossier,
  researchCompanyDossierExa,
  researchCompanyDossierHybrid,
  pickFitAngle,
  type CompanyDossier,
  type PickFitAngleInput,
  type FitAngleResult,
  type ResearchCompanyExaInput,
  type ResearchCompanyHybridInput,
} from './dossier/eng.js'

export {
  // GTM
  isEmptyGtmDossier,
  parseGtmDossier,
  synthesizeGtmDossier,
  researchCompanyDossierGtmHybrid,
  pickGtmAngle,
  type GtmDossier,
  type PickGtmAngleInput,
  type GtmAngleResult,
  type ResearchCompanyGtmHybridInput,
} from './dossier/gtm.js'

export {
  // operations
  isEmptyOpsDossier,
  parseOpsDossier,
  synthesizeOpsDossier,
  researchCompanyDossierOpsHybrid,
  pickOpsAngle,
  type OpsDossier,
  type PickOpsAngleInput,
  type OpsAngleResult,
  type ResearchCompanyOpsHybridInput,
} from './dossier/ops.js'

export {
  // multi-role cache envelope
  parseCachedDossierEnvelope,
  getDossierSlot,
  setDossierSlot,
  type CachedRoleSlot,
  type DossierEnvelope,
} from './dossier/envelope.js'

export type { ResearchCompanyInput } from './dossier/shared.js'
