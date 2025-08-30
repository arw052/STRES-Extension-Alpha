#!/bin/bash
# Github-Commit.sh
# Script to commit and push the STRES-Extension-Clean folder to GitHub
# Can be run from anywhere in the project

# Exit on error
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Get the project root (parent of STRES-Extension-Clean)
if [[ "$SCRIPT_DIR" == *"/STRES-Extension-Clean" ]]; then
    # Script is inside STRES-Extension-Clean directory
    PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
    EXTENSION_DIR="$SCRIPT_DIR"
else
    # Script might be in project root or elsewhere
    # Look for STRES-Extension-Clean relative to current directory
    if [ -d "STRES-Extension-Clean" ]; then
        PROJECT_ROOT="$(pwd)"
        EXTENSION_DIR="$PROJECT_ROOT/STRES-Extension-Clean"
    else
        print_error "Cannot find STRES-Extension-Clean directory."
        print_error "Please run this script from the project root or from within STRES-Extension-Clean/"
        exit 1
    fi
fi

# Check if we're in a git repository
if [ ! -d "$PROJECT_ROOT/.git" ]; then
    print_error "No git repository found in $PROJECT_ROOT"
    print_error "Please initialize git repository first: git init"
    exit 1
fi

# Check if remote is configured and correct
cd "$PROJECT_ROOT"
EXPECTED_REMOTE="https://github.com/arw052/STRES-Extension-Alpha.git"

if ! git remote get-url origin >/dev/null 2>&1; then
    print_warning "No git remote 'origin' configured."
    print_status "Setting up remote for STRES-Extension-Alpha repository..."
    git remote add origin "$EXPECTED_REMOTE"
    print_status "Remote added successfully."
else
    CURRENT_REMOTE=$(git remote get-url origin)
    if [ "$CURRENT_REMOTE" != "$EXPECTED_REMOTE" ]; then
        print_warning "Git remote 'origin' points to wrong repository:"
        print_warning "  Current: $CURRENT_REMOTE"
        print_warning "  Expected: $EXPECTED_REMOTE"
        print_status "Updating remote URL..."
        git remote set-url origin "$EXPECTED_REMOTE"
        print_status "Remote updated successfully."
    fi
fi

# Go to extension directory and add changes
print_status "Adding changes in STRES-Extension-Clean..."
cd "$EXTENSION_DIR"
git add .

# If no commit message is provided, use a default with timestamp
if [ -z "$1" ]; then
    COMMIT_MSG="Update STRES extension - $(date '+%Y-%m-%d %H:%M:%S')"
else
    COMMIT_MSG="$1"
fi

# Check if there are changes to commit
if git diff --cached --quiet; then
    print_warning "No changes to commit in STRES-Extension-Clean directory."
else
    print_status "Committing changes with message: '$COMMIT_MSG'"
    if git commit -m "$COMMIT_MSG"; then
        print_status "Changes committed successfully."
    else
        print_error "Failed to commit changes."
        exit 1
    fi
fi

# Push to GitHub
print_status "Pushing to GitHub (main branch)..."
if git push origin main 2>/dev/null; then
    print_status "Successfully pushed to GitHub!"
    print_status "Repository: https://github.com/arw052/STRES-Extension-Alpha"
elif git push origin main --force-with-lease 2>/dev/null; then
    print_warning "Used force push due to conflicts. Make sure this is intentional."
    print_status "Successfully pushed to GitHub!"
    print_status "Repository: https://github.com/arw052/STRES-Extension-Alpha"
else
    print_error "Failed to push to GitHub."
    print_status "This might be due to:"
    print_status "  1. Authentication issues - set up credentials:"
    print_status "     git config --global credential.helper store"
    print_status "  2. Use SSH instead of HTTPS"
    print_status "  3. Manual push: git push origin main"
    print_status "  4. Pull first if there are conflicts: git pull origin main"
    exit 1
fi

print_status "Extension update complete!"
