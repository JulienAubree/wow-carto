# Relevés en jeu

Chaque fichier `*.json.gz` de ce dossier est une séance de jeu enregistrée par un addon : les PNJ à qui l'on a parlé, les quêtes prises et rendues, avec la position du joueur. Il est importé une seule fois au déploiement (`npm run db:import-classic`, voir `scripts/releves.ts`), puis les points des PNJ sont recalculés à partir de tous les relevés :

- un PNJ de Classic « à vérifier » vu à moins de 30 mètres de sa position de Classic est publié, sous le nom qu'il porte dans Forever ;
- un PNJ vu ailleurs, ou absent de Classic, devient un nouveau point s'il est marchand, formateur, ou s'il donne ou reçoit une quête.

Les fichiers de ce dossier sont considérés comme fiables. Ils ne contiennent ni nom de personnage ni nom de royaume.

## Ajouter une séance ForeverBeacon

1. Quitter le jeu (l'addon écrit son fichier à la déconnexion).
2. Copier, sans rien modifier dans le dossier du jeu :
   `/Applications/World of Warcraft/_classic_beta_/WTF/Account/<compte>/SavedVariables/ForeverBeacon.lua`
   (`_classic_` à la place de `_classic_beta_` après le lancement).
3. Lancer `python3 -I scripts/donnees/extraire_releves.py <copie de ForeverBeacon.lua>` : le script écrit ici `foreverbeacon-<empreinte>.json.gz` et dit ce qu'il a gardé. Les relevés faits avant le lancement du 4 novembre 2026 sont marqués « bêta ».
4. Versionner ce fichier et déployer.

Le fichier de ForeverBeacon s'accumule d'une séance à l'autre (jusqu'à `/fb wipe`) : chaque copie reprend les séances précédentes, et une interaction déjà importée n'est comptée qu'une fois. Un fichier déjà importé (même contenu) est ignoré. Seuls les clients de Forever (version 1.60 et après) en français (frFR) sont acceptés.

Retirer un fichier du dossier ne retire pas ce qu'il a apporté : pour cela, passer son envoi à `ecarte` dans la table `envois`, puis relancer l'import. Ses points redeviennent « à vérifier » (cachés) et ses noms de PNJ et de quêtes sont retirés.
