# AfriMarket Backend

Backend professionnel pour la plateforme de marché AfriMarket - Une marketplace pour la communauté subsaharienne au Maroc.

## 🚀 Stack Technique

- **Runtime** : Node.js 20.x
- **Framework** : Express.js 5.x
- **Database** : PostgreSQL 15.19
- **ORM** : Prisma 5.22.0
- **Authentication** : JWT (JSON Web Tokens)
- **Password Hashing** : bcryptjs (10 salt rounds)
- **Validation** : express-validator
- **Middleware** : CORS, Compression

## 📋 Prérequis

- Node.js 20.x ou supérieur
- PostgreSQL 15+ (ou 5434)
- npm ou yarn

## 🔧 Installation

```bash
# Cloner le dépôt
git clone https://github.com/TraoreMohamed-RagPlatform/afrimarket_backend.git
cd afrimarket_backend

# Installer les dépendances
npm install

# Configurer les variables d'environnement
cp .env.example .env

# Exécuter les migrations Prisma
npx prisma migrate dev

# Démarrer le serveur
npm start
```

## 📁 Structure du Projet
src/
├── controllers/ # Logique métier
├── middleware/ # Middleware Express
├── routes/ # Routes API
├── utils/ # Fonctions utilitaires
└── index.js # Point d'entrée

prisma/
├── schema.prisma # Schéma de la base de données
└── migrations/ # Migrations versionnées

## 🔐 Sécurité

- ✅ Hachage des mots de passe avec bcryptjs
- ✅ JWT pour l'authentification
- ✅ Middleware d'authentification
- ✅ Validation stricte des entrées
- ✅ CORS configuré
- ⏳ Rate Limiting (à venir)
- ⏳ Helmet.js (à venir)

## 📚 API Endpoints

### Authentication
- `POST /api/auth/register` - Créer un nouvel utilisateur
- `POST /api/auth/login` - Se connecter
- `GET /api/auth/me` - Récupérer le profil (protégé)
- `POST /api/auth/logout` - Se déconnecter
- `POST /api/auth/refresh-token` - Renouveler le token

### Vérification Email
- `POST /api/auth/verify-email` - Envoyer un code de vérification
- `POST /api/auth/confirm-email` - Confirmer l'email

## 🗄️ Modèles de Base de Données

- **User** - Utilisateurs avec authentification
- **Listing** - Annonces du marché
- **Image** - Images des annonces
- **Category** - Catégories de produits
- **Message** - Messagerie entre utilisateurs
- **Rating** - Notes et avis
- **Favorite** - Annonces favorites
- **Notification** - Notifications utilisateur
- **Verification** - Vérifications email/téléphone

## 📝 Variables d'Environnement

```env
DATABASE_URL=postgresql://user:password@localhost:5434/afrimarket
JWT_SECRET=your_secret_key_here
JWT_EXPIRY=7d
NODE_ENV=development
PORT=3000
HOST=localhost
CLIENT_URL=http://localhost:3000
```

## 🧪 Tests

```bash
# Utiliser REST Client dans VSCode
# Ouvrir test.http et cliquer sur "Send Request"
```

## 📦 Dépendances Principales

```json
{
  "express": "^5.2.1",
  "@prisma/client": "^5.15.0",
  "bcryptjs": "^3.0.3",
  "jsonwebtoken": "^9.0.3",
  "express-validator": "^7.3.2",
  "dotenv": "^18.0.2"
}
```

## 🚢 Déploiement

Le projet utilise **GitHub Actions** pour CI/CD et DevSecOps.

### Pipelines Configurés
- ✅ Linting et formatage du code
- ✅ Tests automatisés
- ✅ Analyse de sécurité (SAST)
- ✅ Vérification des dépendances

## 📄 Licence

MIT License - Voir [LICENSE](LICENSE) pour plus de détails

## 👥 Auteurs

- **Mohamed Traoré** - Développeur Principal
  - Email: traoremohamed02n02@gmail.com
  - GitHub: [@TraoreMohamed-RagPlatform](https://github.com/TraoreMohamed-RagPlatform)

## 📞 Support

Pour les questions ou les problèmes, créez une issue sur [GitHub Issues](https://github.com/TraoreMohamed-RagPlatform/afrimarket_backend/issues)

---

**Phase 2 Complete** ✅ Authentication Backend
