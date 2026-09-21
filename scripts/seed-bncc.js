/**
 * Script CLI autônomo para inserir Habilidades BNCC diretamente no Firebase RTDB.
 * Lê os dados de `scripts/bncc-seed-data.json` e envia para `diario-classe/bncc`.
 *
 * Modo de uso:
 *   node scripts/seed-bncc.js <email_admin> <senha_admin>
 *
 * Também pode ser chamado via npm:
 *   npm run seed:bncc <email_admin> <senha_admin>
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getDatabase, ref, get, update, push } from 'firebase/database';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const firebaseConfig = {
  apiKey: "AIzaSyDBVGHr9RUJoFQfFcBAXm5elHuI0nKL4oQ",
  authDomain: "diario-de-classe-1f878.firebaseapp.com",
  databaseURL: "https://diario-de-classe-1f878-default-rtdb.firebaseio.com",
  projectId: "diario-de-classe-1f878",
  storageBucket: "diario-de-classe-1f878.firebasestorage.app",
  messagingSenderId: "885884404967",
  appId: "1:885884404967:web:a5a76bf6c0c7a15c624e42"
};

async function main() {
  const jsonPath = path.join(__dirname, 'bncc-seed-data.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('❌ Arquivo de dados não encontrado:', jsonPath);
    process.exit(1);
  }

  const rawSeed = fs.readFileSync(jsonPath, 'utf8');
  const seedItems = JSON.parse(rawSeed);

  console.log('=====================================================');
  console.log('🌱 POPULADOR DE HABILIDADES BNCC NO FIREBASE RTDB');
  console.log('=====================================================');
  console.log(`Total de habilidades no catálogo oficial: ${seedItems.length}`);

  const args = process.argv.slice(2);
  const email = args[0];
  const password = args[1];

  if (!email || !password) {
    console.log('\nUso via CLI:');
    console.log('  node scripts/seed-bncc.js <email_admin> <senha_admin>\n');
    console.log('Exemplo:');
    console.log('  node scripts/seed-bncc.js admin@escola.com 123456\n');
    console.log('💡 DICA: Você também pode popular a base diretamente na tela web:');
    console.log('   Menu "Códigos BNCC" -> Botão "Popular Base BNCC" com 1 clique.\n');
    process.exit(0);
  }

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const rtdb = getDatabase(app);

  console.log(`\nAutenticando usuário: ${email}...`);
  try {
    await signInWithEmailAndPassword(auth, email, password);
    console.log('✅ Autenticado com sucesso!');
  } catch (err) {
    console.error('❌ Falha na autenticação:', err.message);
    process.exit(1);
  }

  try {
    console.log('Buscando habilidades existentes na base...');
    const snap = await get(ref(rtdb, 'diario-classe/bncc'));
    const currentData = snap.val() || {};

    const existingByCode = {};
    Object.keys(currentData).forEach((k) => {
      const item = currentData[k];
      if (item && item.code) {
        const cleanCode = String(item.code).trim().toUpperCase();
        existingByCode[cleanCode] = { id: k, val: item };
      }
    });

    console.log(`Habilidades já existentes na base: ${Object.keys(existingByCode).length}`);

    const updates = {};
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    for (const seedItem of seedItems) {
      const cleanCode = seedItem.code.trim().toUpperCase();
      const existing = existingByCode[cleanCode];

      if (existing) {
        const existingYears = Array.isArray(existing.val.years)
          ? existing.val.years
          : [String(existing.val.year || '1')];

        const needsUpdate = seedItem.years.some((y) => !existingYears.includes(y));

        if (needsUpdate) {
          const mergedYears = Array.from(new Set([...existingYears, ...seedItem.years])).sort();
          updates[`diario-classe/bncc/${existing.id}/years`] = mergedYears;
          updates[`diario-classe/bncc/${existing.id}/year`] = seedItem.year;
          updates[`diario-classe/bncc/${existing.id}/desc`] = seedItem.desc;
          updated++;
        } else {
          unchanged++;
        }
      } else {
        const newRef = push(ref(rtdb, 'diario-classe/bncc'));
        const newKey = newRef.key;
        if (newKey) {
          updates[`diario-classe/bncc/${newKey}`] = {
            code: cleanCode,
            desc: seedItem.desc,
            year: seedItem.year,
            years: seedItem.years,
            createdAt: Date.now()
          };
          inserted++;
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      console.log(`Gravando alterações no banco de dados (${Object.keys(updates).length} registros)...`);
      await update(ref(rtdb), updates);
      console.log('✅ Gravação concluída com sucesso no Firebase RTDB!');
    } else {
      console.log('ℹ️ Nenhuma alteração necessária. A base já contém todas as habilidades atualizadas.');
    }

    console.log('\n--- RESUMO DA OPERAÇÃO ---');
    console.log(`➕ Inseridas: ${inserted}`);
    console.log(`🔄 Atualizadas com blocos plurianuais: ${updated}`);
    console.log(`✔️ Inalteradas (já sincronizadas): ${unchanged}`);
    console.log(`📊 Total no banco agora: ${Object.keys(existingByCode).length + inserted}`);
    console.log('--------------------------\n');

    process.exit(0);
  } catch (err) {
    console.error('❌ Erro na sincronização:', err);
    process.exit(1);
  }
}

main();
