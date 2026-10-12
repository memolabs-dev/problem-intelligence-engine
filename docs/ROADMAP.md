# Problem Intelligence Engine — Roadmap

## Construit (octobre 2026)

- M0 — Postgres, modèles de provenance, scoring qui préserve les inconnues et tests.
- M1 — Sources publiques GitHub/Hacker News, réponses et liens parent/racine, identités de comptes pseudonymisées.
- M2 — Extraction avec citation exacte, vérification sémantique, fallback heuristique contrôlé, historique immutable par run.
- M2.1 — Embeddings locaux all-minilm/pgvector, comparaison explicite de paires par Nemotron, regroupement complete-link, audit des commentaires.
- M2.2 — Recherche KNN ciblée dans les problèmes vérifiés, recherche de nouveaux candidats par GitHub Search et HN Algolia, historique des requêtes de découverte.

## Ensuite, par priorité

### P0 — Mesurer correctement la corroboration

Construire un corpus annoté indépendamment, issu de plusieurs communautés. Mesurer la précision des regroupements, les faux regroupements graves, le rappel des paraphrases et la couverture des réponses. Séparer discussion unique, comptes distincts, récidive temporelle et preuves commerciales.

### P0 — Découverte de récurrences

Automatiser la boucle : problème vérifié → requêtes ciblées → nouvelles observations → extraction → paires KNN → vérification → rapport avec preuves. Garder chaque étape auditable et idempotente. Ne jamais transformer une similarité en preuve de besoin sans verdict.

### P1 — Échelle et robustesse

Pagination contrôlée des fils GitHub/HN, backoff et reprise persistante ; index KNN adapté au volume et relevé de performances. Migration versionnée et tests d'intégration de bout en bout. Limites strictes de ressources/quotas.

### P2 — Validation de marché

Recherche sur alternatives, bénéficiaires, signaux de paiement et accès aux acheteurs ; création de dossiers d'hypothèses. Un problème technique reconnu reste distinct d'une opportunité commercialement validée.

## Définitions non négociables

- *Observation* : message source daté et traçable.
- *Problème vérifié* : difficulté concrète avec citation source et validation du candidat.
- *Corroboration* : preuves de difficultés équivalentes provenant de contextes distincts, après vérification sémantique.
- *Demande commerciale* : preuves supplémentaires sur clients et capacité/volonté de paiement, jamais inférées du nombre de commentaires.
