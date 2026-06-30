import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    const rootDir = path.join(__dirname, '..');
    const vendorDir = path.join(rootDir, 'vendor');
    const sdkVendorDir = path.join(rootDir, 'node_modules', 'wave-agent-sdk', 'vendor');
    
    // Ensure we are in the root directory
    process.chdir(rootDir);

    const args = process.argv.slice(2);
    const packageCurrent = args.includes('--current');
    
    // Run build first
    console.log('Running npm run esbuild:prod...');
    execSync('npm run esbuild:prod', { stdio: 'inherit' });
    
    const vsceArgs = packageCurrent ? '' : '--no-dependencies';

    // Copy vendor directory from wave-agent-sdk
    console.log(`\n=== Copying vendor directory from wave-agent-sdk ===`);
    if (fs.existsSync(vendorDir)) {
        fs.rmSync(vendorDir, { recursive: true, force: true });
    }
    
    if (fs.existsSync(sdkVendorDir)) {
        fs.cpSync(sdkVendorDir, vendorDir, { recursive: true });
        console.log('Copied vendor directory successfully.');
    } else {
        console.error('Error: wave-agent-sdk vendor directory not found!');
        process.exit(1);
    }

    // Copy builtin directory from wave-agent-sdk
    const builtinDir = path.join(rootDir, 'builtin');
    const sdkBuiltinDir = path.join(rootDir, 'node_modules', 'wave-agent-sdk', 'builtin');
    console.log(`\n=== Copying builtin directory from wave-agent-sdk ===`);
    if (fs.existsSync(builtinDir)) {
        fs.rmSync(builtinDir, { recursive: true, force: true });
    }

    if (fs.existsSync(sdkBuiltinDir)) {
        fs.cpSync(sdkBuiltinDir, builtinDir, { recursive: true });
        console.log('Copied builtin directory successfully.');
    } else {
        console.warn('Warning: wave-agent-sdk builtin directory not found, skipping.');
    }

    // Ensure releases directory exists
    const releasesDir = path.join(rootDir, 'releases');
    if (!fs.existsSync(releasesDir)) {
        fs.mkdirSync(releasesDir, { recursive: true });
    }

    // Clean up old .vsix files in releases directory
    for (const f of fs.readdirSync(releasesDir)) {
        if (f.endsWith('.vsix')) {
            fs.unlinkSync(path.join(releasesDir, f));
            console.log(`Cleaned up old vsix: ${f}`);
        }
    }

    console.log(`\n=== Packaging extension ===`);
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
    const version = pkg.version;
    const vsixName = `wave-vscode-chat-${version}.vsix`;
    const vsixPath = path.join(releasesDir, vsixName);
    execSync(`npx vsce package --out ${vsixPath} ${vsceArgs}`, { stdio: 'inherit' });
    
    console.log(`\nCreated releases/${vsixName}`);
    console.log('\nAll targets processed successfully!');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
