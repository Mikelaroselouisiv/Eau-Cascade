# Agents — POS Eau Cascade

## Isolation (critique)

Ce projet est un **fork opérationnel** pour **Eau Cascade**.  
Israel et Frères Baziles doivent continuer à tourner **sans aucune intervention** depuis ce dépôt.

- GCP autorisé : **`eau-cascade`** uniquement
- Compte SDK : config **`pos-eau-cascade`** (`larosemikelson@gmail.com`)
- **Ne jamais** cibler `pos-freres-basiles`, `pos-entrprise-israel`, leurs buckets, VMs, Artifact Registry, secrets GitHub, ou clés PEM

Voir aussi : `.cursor/rules/tenant-isolation-eau-cascade.mdc`  
Garde runtime : `infra/scripts/assert-eau-cascade-gcp.ps1`

## Fuseau horaire (critique)

Toute date métier / affichage / borne de journée = **`America/Port-au-Prince`** uniquement.  
Ne pas utiliser le fuseau OS de la machine ni UTC pour l’UI ou les filtres « jour / mois ».

Voir `apps/backend/src/common/time/timezone.ts` et `apps/desktop/src/renderer/utils/datetime.ts`.
