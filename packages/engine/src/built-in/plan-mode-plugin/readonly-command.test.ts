import { describe, expect, it } from 'vitest';
import { isReadonlyBashCommand } from './readonly-command.js';

describe('isReadonlyBashCommand', () => {
  describe('read-only commands are allowed', () => {
    it('allows each built-in read-only command', () => {
      for (const cmd of [
        'ls',
        'ls -la',
        'cat src/index.ts',
        'echo hello',
        'pwd',
        'head -n 20 src/index.ts',
        'tail -f /dev/null',
        'grep -r "TODO" src',
        'wc -l src/*.py',
        'which node',
        'diff a.txt b.txt',
        'stat src/index.ts',
        'du -sh .',
      ]) {
        expect(isReadonlyBashCommand(cmd).allowed, cmd).toBe(true);
      }
    });

    it('allows unquoted globs on commands whose every flag is read-only', () => {
      expect(isReadonlyBashCommand('ls *.ts').allowed).toBe(true);
      expect(isReadonlyBashCommand('wc -l src/*.py').allowed).toBe(true);
      expect(isReadonlyBashCommand('cat src/*.json').allowed).toBe(true);
    });

    it('allows compound segments when each part is read-only', () => {
      expect(isReadonlyBashCommand('cd packages/api && ls').allowed).toBe(true);
      expect(isReadonlyBashCommand('cd src; grep -r TODO .').allowed).toBe(true);
      expect(isReadonlyBashCommand('ls | head -n 5').allowed).toBe(true);
      expect(isReadonlyBashCommand('ls && pwd && echo ok').allowed).toBe(true);
    });

    it('allows redirect to /dev/null', () => {
      expect(isReadonlyBashCommand('grep -r pattern . 2>/dev/null').allowed).toBe(true);
      expect(isReadonlyBashCommand('ls > /dev/null').allowed).toBe(true);
    });

    it('allows quoted strings', () => {
      expect(isReadonlyBashCommand("echo 'hello world'").allowed).toBe(true);
      expect(isReadonlyBashCommand('echo "hello world"').allowed).toBe(true);
    });

    it('allows read-only git forms', () => {
      for (const cmd of [
        'git status',
        'git status --short',
        'git diff',
        'git log --oneline -5',
        'git show HEAD',
        'git blame src/index.ts',
        'git ls-files',
        'git rev-parse --show-toplevel',
        'git remote -v',
        'git branch',
        'git --version',
        'git -C /tmp status',
      ]) {
        expect(isReadonlyBashCommand(cmd).allowed, cmd).toBe(true);
      }
    });

    it('allows cd into the workspace', () => {
      expect(isReadonlyBashCommand('cd packages/engine && ls').allowed).toBe(true);
      expect(isReadonlyBashCommand('cd .').allowed).toBe(true);
    });
  });

  describe('mutating commands are blocked', () => {
    it('blocks commands outside the read-only set', () => {
      for (const cmd of [
        'rm -rf /',
        'rm src/index.ts',
        'mkdir foo',
        'touch file.txt',
        'mv a.txt b.txt',
        'cp a.txt b.txt',
        'curl http://example.com',
        'wget http://example.com',
        'sort file.txt',
        'sed -i s/x/y/g file.txt',
        'npm install',
        'pnpm build',
        'bash -c "rm -rf /"',
        'python -c "print(1)"',
        'node script.js',
        'git add .',
        'git commit -m "x"',
        'git push origin main',
        'git checkout main',
        'git reset --hard',
        'git clean -fd',
      ]) {
        expect(isReadonlyBashCommand(cmd).allowed, cmd).toBe(false);
      }
    });

    it('blocks output redirection to a real file', () => {
      expect(isReadonlyBashCommand('echo hi > out.txt').allowed).toBe(false);
      expect(isReadonlyBashCommand('ls >> log.txt').allowed).toBe(false);
      expect(isReadonlyBashCommand('echo hi 2> err.txt').allowed).toBe(false);
    });

    it('blocks find with write-capable flags', () => {
      for (const cmd of [
        'find . -name "*.js" -delete',
        'find . -name "*.js" -exec rm {} \\;',
        'find . -name "*.js" -ok rm {} \\;',
        'find . -name "*.js" -touch',
      ]) {
        expect(isReadonlyBashCommand(cmd).allowed, cmd).toBe(false);
      }
    });

    it('allows find without write flags but blocks find with globs', () => {
      expect(isReadonlyBashCommand('find . -name "*.js"').allowed).toBe(true);
      expect(isReadonlyBashCommand('find . -name *.js').allowed).toBe(false);
    });

    it('blocks command substitution and backticks', () => {
      expect(isReadonlyBashCommand('ls $(pwd)').allowed).toBe(false);
      expect(isReadonlyBashCommand('echo $(rm -rf /)').allowed).toBe(false);
      expect(isReadonlyBashCommand('echo `ls`').allowed).toBe(false);
      expect(isReadonlyBashCommand('echo "$(cat /etc/passwd)"').allowed).toBe(false);
    });

    it('blocks cd leaving the workspace', () => {
      expect(isReadonlyBashCommand('cd /etc && ls').allowed).toBe(false);
      expect(isReadonlyBashCommand('cd .. && ls').allowed).toBe(false);
      expect(isReadonlyBashCommand('cd ~ && ls').allowed).toBe(false);
    });

    it('blocks cd combined with output redirection', () => {
      expect(isReadonlyBashCommand('cd src && ls > out.txt').allowed).toBe(false);
    });

    it('blocks unparseable commands (fail closed)', () => {
      expect(isReadonlyBashCommand("echo 'unbalanced").allowed).toBe(false);
      expect(isReadonlyBashCommand('echo \\').allowed).toBe(false);
      expect(isReadonlyBashCommand(''.padEnd(10001, 'a')).allowed).toBe(false);
    });

    it('blocks empty or missing commands', () => {
      expect(isReadonlyBashCommand('').allowed).toBe(false);
      expect(isReadonlyBashCommand('   ').allowed).toBe(false);
    });
  });
});
