#!/bin/bash
set -e

# Konfiguration
VERSION_FILE="package.json"
MAIN_BRANCH="main"

# Versionsnummer vom Benutzer entgegennehmen oder automatisch erhöhen
if [ "$1" = "--auto" ]; then
    CURRENT_VERSION=$(grep '"version":' "$VERSION_FILE" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
    MAJOR=$(echo "$CURRENT_VERSION" | cut -d. -f1)
    MINOR=$(echo "$CURRENT_VERSION" | cut -d. -f2)
    PATCH=$(echo "$CURRENT_VERSION" | cut -d. -f3)
    
    echo "Aktuelle Version: $CURRENT_VERSION"
    read -p "Welchen Typ möchtest du release? (major/minor/patch): " TYPE
    
    case $TYPE in
        major)
            NEW_VERSION="$((MAJOR + 1)).0.0"
            ;;
        minor)
            NEW_VERSION="$MAJOR.$((MINOR + 1)).0"
            ;;
        patch|*)
            NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
            ;;
    esac
    
    echo "Neue Version: $NEW_VERSION"
else
    NEW_VERSION=$1
fi

if [ -z "$NEW_VERSION" ]; then
    read -p "Versionsnummer eingeben (oder Enter für auto): " NEW_VERSION
fi

if [ -z "$NEW_VERSION" ]; then
    echo "Fehler: Keine Versionsnummer angegeben."
    exit 1
fi

# Semver Format validieren
if ! [[ $NEW_VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Fehler: Ungültiges semantisches Versionierungsformat. Erwartet: X.Y.Z"
    exit 1
fi

echo ""
echo "Erstelle Release v$NEW_VERSION"
echo ""

# Versionsnummer in package.json aktualisieren
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" "$VERSION_FILE"
echo "✓ package.json aktualisiert auf v$NEW_VERSION"

# Git Status prüfen
if ! git diff --quiet --cached; then
    echo "Fehler: Es gibt staged changes."
    exit 1
fi

git add "$VERSION_FILE"

# Commit erstellen
git commit -m "chore: release version $NEW_VERSION"
echo "✓ Commit erstellt"

# Auf main pushen (mit Pull zuerst um Konflikte zu vermeiden)
git fetch origin "$MAIN_BRANCH"
if ! git merge-base --is-ancestor "$(git rev-parse HEAD)" origin/"$MAIN_BRANCH"; then
    echo "Pull von remote..."
    git pull origin "$MAIN_BRANCH" --rebase || {
        echo "Fehler: Merge-Konflikte beim Rebase."
        exit 1
    }
fi

echo ""
read -p "Möchtest du auf main pushen? (j/N): " PUSH_CONFIRM
if [[ $PUSH_CONFIRM =~ ^[Jj]$ ]]; then
    git push origin "$MAIN_BRANCH"
    echo "✓ Auf main gepusht"
else
    echo "Abgebrochen. Führe 'git push origin main' manuell aus."
fi

echo ""
echo "Release v$NEW_VERSION erfolgreich erstellt!"
echo ""
echo "Nächste Schritte:"
echo "1. Docker Image bauen und pushen: docker build -t ghcr.io/sheet-player:$NEW_VERSION ."
echo "2. Oder GitHub Actions Workflow wird automatisch ausgelöst"
