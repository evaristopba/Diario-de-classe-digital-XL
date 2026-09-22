import fs from 'fs';
import { execSync } from 'child_process';

console.log('--- 1. Compilando HTML Único com viteSingleFile ---');
try {
  execSync('npx vite build --config vite.config.singlefile.ts', { stdio: 'inherit' });
  if (fs.existsSync('dist-singlefile/index.html')) {
    fs.copyFileSync('dist-singlefile/index.html', 'public/app-unico.html');
    fs.copyFileSync('dist-singlefile/index.html', 'public/diario-de-classe.html');
    console.log('✅ HTML único gerado com sucesso em public/app-unico.html e public/diario-de-classe.html');
  }
} catch (e) {
  console.error('Erro ao compilar singlefile:', e);
}

console.log('--- 2. Empacotando Código-Fonte em ZIP ---');
try {
  execSync(`python3 -c "
import os, zipfile

ignore_dirs = {'node_modules', 'dist', 'dist-singlefile', '.git', '.cache'}
ignore_files = {'diario-de-classe.zip', 'diario-classe.zip', 'diario-de-classe-projeto.zip', 'projeto-diario-classe.tar.gz', 'app-unico.html', 'diario-de-classe.html'}

def make_zip(out_path):
    if os.path.exists(out_path):
        try:
            os.remove(out_path)
        except Exception:
            pass
    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk('.'):
            dirs[:] = [d for d in dirs if d not in ignore_dirs]
            for file in files:
                if file in ignore_files or file.endswith('.zip') or file.endswith('.tar.gz'):
                    continue
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, '.')
                zipf.write(full_path, rel_path)

make_zip('public/diario-de-classe.zip')
make_zip('public/diario-classe.zip')
make_zip('public/diario-de-classe-projeto.zip')
print('✅ Todos os arquivos ZIP criados com sucesso!')
"`, { stdio: 'inherit' });
} catch (e) {
  console.error('Erro ao criar ZIP:', e);
}
console.log('--- Processo de empacotamento finalizado ---');
