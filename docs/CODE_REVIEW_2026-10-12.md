# Revue technique — 12 octobre 2026

## Périmètre

Moteur local Problem Intelligence Engine : collecte, extraction, validation, historique PostgreSQL, pgvector, rapprochement sémantique et témoignages dans les conversations.

L'examen couvre les modifications locales et les modules ajoutés avant publication. Les données historiques et les clés locales ne font **pas** partie du commit.

## Défauts corrigés

1. **Historique fragile quand une observation change** : les nouveaux identifiants de runs dépendent des empreintes des sources. Le rapport conserve `sourceContentHash`, et l'import refuse un résultat si son texte source a changé entre l'extraction et la persistance, y compris quand le modèle avait répondu « aucun problème ».
2. **Cache de corroboration périmé** : la clé de cache inclut une version explicite des règles sémantiques (`SEMANTIC_REVIEW_POLICY_VERSION`) et pas uniquement les noms des modèles. Les verdicts peuvent donc être réévalués après évolution du contrat.
3. **Comptage des comptes erroné** : le graphe relit `reporter_key` de PostgreSQL plutôt qu'un ancien champ `authorId` absent de la base.
4. **Import incomplet** : les décisions archivées enregistrent maintenant `extraction_method`, pour distinguer un candidat du modèle d'une récupération heuristique.
5. **Sélection « recent » trompeuse** : la sélection utilise effectivement `published_at DESC` et non l'ordre alphabétique des identifiants.
6. **Accumulation des sauvegardes de l'outil d'édition** : sauvegardes archivées hors dépôt dans un fichier privé, répertoire de travail nettoyé.

## Garanties actuelles

- Le rapport d'extraction conserve les erreurs séparément des absences de problème.
- La citation soumise à l'évaluateur reste retrouvable dans le texte source.
- Les commentaires d'une même discussion n'incrémentent pas le nombre de discussions indépendantes.
- Une similarité vectorielle seule ne fusionne rien ; une décision sémantique est requise.
- Une fusion par chaîne A≈B≈C est refusée lorsque A≈C n'est pas confirmé.
- Les modèles payants OpenRouter sont interdits dans ces commandes ; les clés restent dans `.env`, ignoré par Git.

## Vérifications de publication

- Suite unitaires et tests PostgreSQL exécutés avec `PIE_INTEGRATION=1 npm test`.
- Contrôle des différences Git : `git diff --check`.
- Workflow GitHub Actions ajouté avec une image PostgreSQL + pgvector pour éviter de dépendre de la configuration du Mac.

## Risques connus / chantiers suivants

**P0 — Qualité de la corroboration :** huit paires synthétiques servent à la mise au point, **pas** de preuve de généralisation. Constituer un ensemble de paires annoté à l'aveugle à partir de sources indépendantes.

**P0 — Découverte :** la recherche de paires reste quadratique dans le nombre de problèmes (toutes les paires courantes). Implémenter une recherche KNN bornée sur pgvector/HNSW, puis valider le rappel sur des paraphrases difficiles.

**P1 — Commentaires :** le filtre d'expérience directe privilégie la précision, mais peut manquer des formulations implicites. Ne jamais convertir un compte pseudonymisé en « personne indépendante ».

**P1 — Collecte :** les conversations sont tronquées selon une limite configurable. Compléter la pagination GitHub et la reprise Hacker News avant d'utiliser le volume comme indicateur.

**P1 — Maintien :** versionner explicitement le prompt et les paramètres de l'évaluateur, et stocker le nombre de tokens/temps/cout quand les fournisseurs les exposent.

**Principe permanent :** une observation vérifiée, une récurrence et une opportunité commerciale sont trois conclusions distinctes. Une quantité de messages ou un score d'IA ne prouve ni marché, ni volonté de payer.
