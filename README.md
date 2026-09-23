\# AfriMarket Backend 🚀



Un backend robuste et scalable pour la plateforme de marketplace AfriMarket, construit avec Node.js, Express et Prisma.



\## 📋 Table des Matières



\- \[À propos](#à-propos)

\- \[Prérequis](#prérequis)

\- \[Installation](#installation)

\- \[Configuration](#configuration)

\- \[Démarrage du serveur](#démarrage-du-serveur)

\- \[Structure du projet](#structure-du-projet)

\- \[API Endpoints](#api-endpoints)

\- \[Authentification](#authentification)

\- \[Base de données](#base-de-données)

\- \[Variables d'environnement](#variables-denvironnement)

\- \[Dépendances](#dépendances)

\- \[Contributing](#contributing)

\- \[License](#license)



\## À propos



AfriMarket Backend est un serveur Node.js/Express qui gère :

\- ✅ Authentification des utilisateurs (Register, Login, JWT)

\- ✅ Gestion des profils utilisateurs

\- ✅ Vérification d'email

\- ✅ Tokens de rafraîchissement

\- ✅ Middleware de sécurité

\- ✅ Compression des réponses

\- ✅ CORS configuré

\- ✅ Health check API



\## Prérequis



Avant de commencer, assurez-vous d'avoir installé :



\- \*\*Node.js\*\* (v14.0.0 ou plus)

\- \*\*npm\*\* (livré avec Node.js)

\- \*\*PostgreSQL\*\* (ou votre base de données configurée)

\- \*\*Git\*\* (pour cloner le dépôt)



\## Installation



\### 1. Cloner le dépôt



```bash

git clone https://github.com/votre-username/afrimarket\_backend.git

cd afrimarket\_backend

```



\### 2. Installer les dépendances



```bash

npm install

```



\### 3. Configurer Prisma



```bash

npx prisma generate

npx prisma migrate dev --name init

```



\### 4. Configuration des variables d'environnement



Créez un fichier `.env` à la racine du projet avec les valeurs de `.env.example`.



\## Démarrage du serveur



\### Mode développement



```bash

npm run dev

```



\### Mode production



```bash

npm start

```



\## API Endpoints



\### Authentication Routes



\#### Register

```http

POST /api/auth/register

```



\#### Login

```http

POST /api/auth/login

```



\#### Get Profile

```http

GET /api/auth/me

```



\#### Health Check

```http

GET /api/health

```



\## License



MIT License - Voir le fichier LICENSE pour plus de détails.

