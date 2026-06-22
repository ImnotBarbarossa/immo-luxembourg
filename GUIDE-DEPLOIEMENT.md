# 🏠 Guide de déploiement — Immo Luxembourg

## Ce que vous allez obtenir
- Un site accessible depuis votre téléphone, tablette ou ordinateur
- URL du type : https://immo-luxembourg.netlify.app
- Totalement gratuit, sans carte bancaire

---

## Étape 1 — Obtenir votre clé API Anthropic (5 min)

Le site utilise l'IA Claude pour générer les annonces. Vous avez besoin d'une clé API.

1. Allez sur **https://console.anthropic.com**
2. Créez un compte (gratuit) ou connectez-vous
3. Cliquez sur **"API Keys"** dans le menu gauche
4. Cliquez sur **"Create Key"**, donnez-lui un nom (ex: "Immo Luxembourg")
5. **Copiez la clé** (elle commence par `sk-ant-...`) — vous ne pourrez plus la voir après

> ⚠️ Gardez cette clé secrète, ne la partagez jamais.

---

## Étape 2 — Insérer votre clé dans le fichier index.html

1. Ouvrez le fichier **index.html** avec un éditeur de texte
   - Sur Windows : clic droit → "Ouvrir avec" → Notepad
   - Sur Mac : clic droit → "Ouvrir avec" → TextEdit
2. Appuyez sur **Ctrl+F** (ou Cmd+F sur Mac) et cherchez :
   ```
   YOUR_API_KEY_HERE
   ```
3. Remplacez `YOUR_API_KEY_HERE` par votre vraie clé API
4. Sauvegardez le fichier

---

## Étape 3 — Déployer sur Netlify (3 min)

1. Allez sur **https://netlify.com**
2. Cliquez sur **"Sign up"** → choisissez "Email" et créez un compte gratuit
3. Une fois connecté, sur le tableau de bord, cherchez la zone :
   **"Want to deploy a new site without connecting to Git?"**
   et cliquez sur **"deploy manually"**
4. **Glissez-déposez le dossier entier** `immo-luxembourg` dans la zone indiquée
5. Netlify déploie automatiquement en 30 secondes
6. Vous obtenez une URL du type `https://random-name-123.netlify.app`

### Personnaliser l'URL (optionnel)
1. Dans Netlify, allez dans **"Site settings" → "Domain management"**
2. Cliquez sur **"Options" → "Edit site name"**
3. Tapez `immo-luxembourg` (ou tout autre nom disponible)
4. Votre site sera accessible sur `https://immo-luxembourg.netlify.app`

---

## Étape 4 — Tester depuis votre téléphone

1. Ouvrez l'URL de votre site sur votre téléphone
2. Sur iPhone : appuyez sur le bouton de partage → "Sur l'écran d'accueil"
3. Sur Android : menu du navigateur → "Ajouter à l'écran d'accueil"

Le site fonctionne comme une application mobile !

---

## À propos des alertes email

Les alertes sont actuellement **enregistrées localement** sur votre appareil.
Pour recevoir de vrais emails automatiques, deux options :

### Option A — Service gratuit : EmailJS
1. Créez un compte sur **https://emailjs.com** (gratuit jusqu'à 200 emails/mois)
2. Connectez votre Gmail (antoine.denauw@gmail.com)
3. Demandez-moi d'intégrer EmailJS dans le site

### Option B — Zapier (sans code)
1. Créez un compte sur **https://zapier.com**
2. Créez un "Zap" : Webhook → Gmail
3. Demandez-moi de configurer le webhook dans le site

---

## Résolution de problèmes

**Le site affiche une erreur "API Key"**
→ Vérifiez que vous avez bien remplacé `YOUR_API_KEY_HERE` dans index.html

**La recherche ne retourne rien**
→ Vérifiez votre connexion internet et que votre clé API est valide sur console.anthropic.com

**Netlify dit "Build failed"**
→ Glissez-déposez uniquement le dossier `immo-luxembourg`, pas un fichier zip

---

## Besoin d'aide ?

Revenez dans Claude et demandez-moi :
- "Intègre EmailJS pour les vraies alertes email"
- "Ajoute un filtre surface minimum"
- "Ajoute une carte des annonces"
