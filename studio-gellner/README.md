# Studio Gellner — proposition de nouveau site

Site statique (HTML, CSS, JavaScript, aucune compilation) avec une histoire en 3D au défilement : la maison naît sous les yeux du visiteur, du terrain à la lumière du soir.

1. **Il luogo** : la vallée et les Dolomites, le terrain est nivelé et piqueté.
2. **Lo schizzo** : les volumes sont dessinés au crayon.
3. **Il progetto** : le plan bleu se trace au sol (cloisons, escalier, portes, cotes, mobilier).
4. **La struttura** : dalle, poteaux et poutres en lamellé-collé, chevrons.
5. **L'involucro** : pierre au rez-de-chaussée, mélèze à l'étage, baies vitrées, balcon, toiture, cheminée, terrasse.
6. **La luce** : passage à l'heure bleue, la maison s'allume, la neige tombe.
7. **Benvenuti a casa** : appel à prendre contact.

Ensuite : manifeste (les mots s'allument à la lecture), le studio, l'héritage d'Edoardo Gellner (frise horizontale au défilement), les services, le contact. Trois langues : italien, anglais, français.

## Lancer en local

```bash
cd studio-gellner
python3 -m http.server 8080   # puis http://localhost:8080
```

## Mettre en ligne

N'importe quel hébergement statique : Netlify, Vercel, GitHub Pages, Infomaniak… Il suffit de déposer le dossier.

## Détails techniques

- three.js est inclus dans `vendor/` : aucun CDN nécessaire pour la 3D.
- Toute la scène est générée par le code : montagnes, forêt, maison, textures de mélèze et de pierre. Aucune image à charger.
- Pause automatique quand la scène n'est plus à l'écran. Mode « réduire les animations » respecté. Image de repli si WebGL est indisponible.

## À vérifier ou fournir par le studio avant publication

- **Contenu** : le site d'origine n'a pas pu être consulté (bloqué par le réseau). Les textes sont rédigés à partir de sources publiques :
  - l'adresse Via Menardi 6, Cortina d'Ampezzo ;
  - la biographie d'Edoardo Gellner et ses œuvres.

  Le studio doit relire :
  - la biographie et la frise ;
  - la liste des services ;
  - l'adresse e-mail `info@studiogellner.com` (supposée).
- **Projets** : il manque une galerie des projets récents du studio. Prévoir des photos haute définition et un court texte par projet.
- **Juridique** : mentions légales, P.IVA (numéro de TVA), politique de confidentialité.
