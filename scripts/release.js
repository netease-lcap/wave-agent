import { execSync } from 'node:child_process';

const type = process.argv[2] || 'patch';

try {
  // 1. Ensure we are on main and up to date
  console.log('Checking git status...');
  const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  if (currentBranch !== 'main' && currentBranch !== 'master') {
    console.error('Error: You must be on main or master branch to run this script.');
    process.exit(1);
  }
  
  execSync('git pull origin main', { stdio: 'inherit' });

  // 2. Create a temporary branch
  const tempBranch = `release-${type}-${Date.now()}`;
  console.log(`Creating temporary branch: ${tempBranch}`);
  execSync(`git checkout -b ${tempBranch}`, { stdio: 'inherit' });

  // 3. Run the existing version script
  console.log(`Running version.js ${type} all...`);
  execSync(`node scripts/version.js ${type} all`, { stdio: 'inherit' });

  // 4. Push branch and tag
  console.log('Pushing branch and tags...');
  execSync('git push -u origin HEAD --follow-tags', { stdio: 'inherit' });

  // 5. Create PR and set auto-merge
  console.log('Creating Pull Request and enabling auto-merge...');
  execSync('gh pr create --fill', { stdio: 'inherit' });
  execSync('gh pr merge --auto --rebase', { stdio: 'inherit' });

  // 6. Switch back to main and cleanup
  console.log('Cleaning up...');
  execSync('git checkout main', { stdio: 'inherit' });
  execSync(`git branch -D ${tempBranch}`, { stdio: 'inherit' });

  console.log('\nDone! Your release PR has been created and set to auto-merge once CI passes.');
} catch (error) {
  console.error('\nRelease failed:', error.message);
  // Try to get back to main if we failed
  try {
    execSync('git checkout main', { stdio: 'ignore' });
  } catch (e) {}
  process.exit(1);
}
