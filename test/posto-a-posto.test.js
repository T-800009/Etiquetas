'use strict';

// Testes da leitura das planilhas posto a posto e da comparação entre projetos.
// Os códigos aqui são inventados (só têm o mesmo formato dos reais).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../public/posto-a-posto.js');

const CAB = ['SAP', 'Part Number', 'Descrição', 'Qtde', 'Und'];

test('reconhece os postos em títulos, valores, endereços e nomes de aba', () => {
  assert.equal(P.lerPosto('Posto 0', { exigirPrefixo: true }), '0');
  assert.equal(P.lerPosto('Posto ½', { exigirPrefixo: true }), '½');
  assert.equal(P.lerPosto('posto meio', { exigirPrefixo: true }), '½');
  assert.equal(P.lerPosto('P10', { exigirPrefixo: true }), '10');
  assert.equal(P.lerPosto('Posto', { exigirPrefixo: true }), null);
  assert.equal(P.lerPosto('Qtde', { exigirPrefixo: true }), null);
  assert.equal(P.lerPosto('Part Number', { exigirPrefixo: true }), null);
  assert.equal(P.lerPosto('02'), '2');
  assert.equal(P.lerPosto('02', { exigirPrefixo: true }), null);

  assert.equal(P.postoDoEndereco('02.A.C2'), '2');
  assert.equal(P.postoDoEndereco('0½.RACK.A1'), '½');
  assert.equal(P.postoDoEndereco('00.PALLET.01'), '0');
  assert.equal(P.postoDoEndereco('10.B'), '10');
  assert.equal(P.postoDoEndereco('RACK'), null);

  assert.equal(P.postoDaAba('P05', ['P0', 'P05', 'P5']), '½');
  assert.equal(P.postoDaAba('P05', ['P0', 'P05']), '5');
  assert.equal(P.postoDaAba('Master List', []), null);

  assert.equal(P.textoPostos(['5', '1', '½']), 'Postos ½, 1 e 5');
  assert.equal(P.textoPostos(['3']), 'Posto 3');
  assert.deepEqual(['10', '', '½', '2', '0'].sort(P.compararPostos), ['0', '½', '2', '10', '']);
});

// Planilha no formato "Posto a Posto Logística": Master List + uma aba por posto + BOM.
function planilhaLogistica() {
  const master = [
    [...CAB, 'Posto 0', 'Posto ½', 'Posto 1', 'Posto 2', '', 'VERIFICAR'],
    ['10000001-00', 'XX12S01-0001A', 'Viga frontal', '1', 'Pç', '1', '', '', '', '', '0'],
    ['10000002-00', '10000002-00', 'Abraçadeira de nylon', '26', 'Pç', '', '14', '', '12', '', '0'],
    ['', 'XX12S01-0003B', 'Rack traseiro', '1', 'Pç', '1', '', '', '', '', '0'], // SAP #N/A (vem vazio do Excel)
    ['10000004-00', 'Q0000004', 'Parafuso flangeado', '8', 'Pç', '', '', '4', '4', '', '0'],
    ['10000004-00', 'Q0000004', 'Parafuso flangeado', '8', 'Pç', '', '', '4', '4', '', '0'], // linha repetida
    ['10000005-00', 'XX12S01-0005', 'Chicote de aterramento', '1', 'Pç', '', '', 'Kit', '', '', '0'],
  ];
  const p1 = [
    [...CAB, 'Posto 1'],
    ['10000004-00', 'Q0000004', 'Parafuso flangeado', '8', 'Pç', '4'],
    ['10000005-00', 'XX12S01-0005', 'Chicote de aterramento', '1', 'Pç', 'Kit'],
    ['TKC-0000099', '8'], // anotação solta no fim da aba
  ];
  const p05 = [
    [...CAB, 'Posto ½'],
    ['10000002-00', '10000002-00', 'Abraçadeira de nylon', '26', 'Pç', '14'],
  ];
  const bom = [
    ['Car Number', 'SAP(物料编码)', 'Material Description', 'BYD P/N', 'Unit', 'Total'],
    ['XX12S01-DWB0001', '10000001-00', 'Viga', 'XX12S01-0001A', 'PCS', '1'],
  ];
  return [
    { nome: 'Master List', linhas: master },
    { nome: 'P1', linhas: p1 },
    { nome: 'P05', linhas: p05 },
    { nome: 'BOM (Master)', linhas: bom },
  ];
}

test('lê a Master List com as colunas de posto e prefere ela às abas por posto', () => {
  const opcoes = P.analisar(planilhaLogistica());
  assert.deepEqual(
    opcoes.map((o) => o.tipo),
    ['matriz', 'abas-por-posto', 'sem-posto'],
  );
  const [master] = opcoes;
  assert.match(master.titulo, /Master List/);
  assert.deepEqual(master.postos, ['0', '½', '1', '2']);
  assert.equal(master.materiais, 5);
  const resumo = master.entradas.map((e) => `${e.posto}:${e.codigo || e.partNumber}:${e.qtde}`);
  assert.deepEqual(resumo, [
    '0:10000001-00:1',
    '½:10000002-00:14',
    '2:10000002-00:12',
    '0:XX12S01-0003B:1',
    '1:10000004-00:4',
    '2:10000004-00:4',
    '1:10000005-00:Kit',
  ]);

  const abas = opcoes[1];
  assert.match(abas.titulo, /2 abas/);
  assert.deepEqual(abas.postos, ['½', '1'], 'aba P05 com título "Posto ½"; a anotação solta é ignorada');
  assert.equal(abas.entradas.length, 3);
});

test('lê lista com endereço (cadastro de etiquetas) e lista sem posto (BOM)', () => {
  const cadastro = [
    ['Código do material', 'Descrição', 'Referência / especificação', 'BOM', 'Endereço / posição', 'Projeto / linha'],
    ['10000001-00', 'Viga frontal', 'XX12S01-0001A', '', '00.PALLET.02', 'Posto 0'],
    ['10000002-00', 'Abraçadeira', '10000002-00', '', '0½.B', 'Posto ½'],
    ['10000002-00', 'Abraçadeira', '10000002-00', '', '02.A', 'Posto 2'],
  ];
  const [lista] = P.analisar([{ nome: 'Materiais', linhas: cadastro }]);
  assert.equal(lista.tipo, 'lista');
  assert.deepEqual(lista.postos, ['0', '½', '2']);

  const comColunaPosto = [
    ['Material', 'Texto breve material', 'Posto'],
    ['10000001-00', 'Viga', 'Posto 3'],
    ['10000002-00', 'Abraçadeira', '½'],
  ];
  const [porColuna] = P.analisar([{ nome: 'Lista', linhas: comColunaPosto }]);
  assert.equal(porColuna.tipo, 'lista');
  assert.deepEqual(porColuna.postos, ['½', '3']);

  const [bom] = P.analisar([{ nome: 'CONSUMO', linhas: [['Material', 'Texto breve material', 'Qtd'], ['10000001-00', 'Viga', '2'], ['10000009-00', 'Porca', '4']] }]);
  assert.equal(bom.tipo, 'sem-posto');
  assert.deepEqual(bom.postos, ['']);
});

test('descobre o projeto pelo nome do arquivo ou pelos desenhos', () => {
  assert.equal(P.detectarProjeto([], 'Posto_a_Posto_BC22_V2.xlsx'), 'BC22');
  const planilha = [{ nome: 'Master List', linhas: [['SAP', 'Part Number'], ['1', 'BC12S01-0001'], ['2', 'BC12S01-0002'], ['3', 'BC22S01-0003']] }];
  assert.equal(P.detectarProjeto(planilha, 'Posto_a_Posto_Logistica_V7.xlsx'), 'BC12');
  assert.equal(P.detectarProjeto([{ nome: 'x', linhas: [['a']] }], 'lista.xlsx'), '');
});

const e = (posto, codigo, partNumber, qtde = '1', descricao = '') => ({ posto, codigo, partNumber, descricao, qtde, unidade: 'Pç' });

test('compara posto a posto: comum, comum em outro posto, não comum e só na base', () => {
  const bc22 = [
    e('1', '10000001-00', 'Q0000001', '2', 'Parafuso'),
    e('1', '10000002-00', 'Q0000002'),
    e('1', '20000003-00', 'XX22S01-0003', '1', 'Suporte novo'),
    e('2', '', 'Q0000004'), // sem SAP: casa pelo Part Number
  ];
  const bc12 = [
    e('1', '10000001-00', 'Q0000001', '4', 'Parafuso'),
    e('2', '10000002-00', 'Q0000002'),
    e('2', '10000004-00', 'Q0000004'),
    e('1', '10000009-00', 'XX12S01-0009'),
  ];
  const r = P.comparar(bc22, bc12);
  const linhas = r.linhas.map((l) => `${l.posto}|${l.material.codigo}|${l.situacao}`);
  assert.deepEqual(linhas, [
    '1|20000003-00|nao-comum',
    '1|10000002-00|comum-outro',
    '1|10000001-00|comum',
    '1|10000009-00|so-base',
    '2|10000004-00|comum',
    '2|10000002-00|so-base',
  ]);
  const parafuso = r.linhas.find((l) => l.material.codigo === '10000001-00');
  assert.equal(parafuso.qtdDiferente, true, 'mesmo material, quantidade diferente no posto');
  const abracadeira = r.linhas.find((l) => l.situacao === 'comum-outro');
  assert.deepEqual(abracadeira.material.postosB, ['2']);
  assert.equal(r.linhas.find((l) => l.posto === '2' && l.situacao === 'comum').material.codigo, '10000004-00', 'pega o SAP do outro projeto');

  assert.deepEqual(r.resumo, { materiaisNovo: 4, materiaisBase: 4, comuns: 3, naoComuns: 1, soBase: 1, postoDiferente: 1 });
  const posto1 = r.postos.find((p) => p.posto === '1');
  assert.deepEqual(posto1, { posto: '1', comum: 1, 'comum-outro': 1, 'nao-comum': 1, 'so-base': 1, novo: 3 });
});

test('lista sem posto (só a BOM) usa os postos do outro projeto', () => {
  const bc22Bom = [e('', '10000001-00', 'Q0000001', '6'), e('', '20000003-00', 'XX22S01-0003')];
  const bc12 = [e('1', '10000001-00', 'Q0000001', '2'), e('3', '10000001-00', 'Q0000001', '4'), e('1', '10000009-00', 'XX12S01-0009')];
  const r = P.comparar(bc22Bom, bc12);
  assert.deepEqual(
    r.linhas.map((l) => `${l.posto}|${l.material.codigo}|${l.situacao}|${l.inferido || ''}`),
    ['1|10000001-00|comum|a', '1|10000009-00|so-base|', '3|10000001-00|comum|a', '|20000003-00|nao-comum|'],
  );
  assert.equal(r.linhas[0].qtdDiferente, false, 'quantidade total da BOM não é comparada com a do posto');
});

test('prefere a descrição em português e limpa a unidade repetida da BOM da China', () => {
  const [bom] = P.analisar([{ nome: 'BOM', linhas: [['SAP(物料编码)', 'Material Description(物料描述)', 'Unit(单位)', 'Total(数量)'], ['10000001-00', 'XX-0001_螺栓', 'PCS PCS', '2']] }]);
  assert.equal(bom.tipo, 'sem-posto');
  assert.equal(bom.entradas[0].unidade, 'PCS');
  const r = P.comparar(bom.entradas, [e('1', '10000001-00', '', '2', 'Parafuso')]);
  assert.equal(r.materiais[0].descricao, 'Parafuso');
});

test('acha o material pelo código bipado, sem o -00 ou pelo Part Number', () => {
  const { materiais } = P.comparar([e('1', '10000001-00', 'Q0000001')], [e('2', '10000002-00', 'XX12S01-0002')]);
  assert.equal(P.acharMaterial(materiais, ' 10000001-00 ')[0].codigo, '10000001-00');
  assert.equal(P.acharMaterial(materiais, '10000002')[0].codigo, '10000002-00');
  assert.equal(P.acharMaterial(materiais, 'xx12s01-0002')[0].situacao, 'so-base');
  assert.deepEqual(P.acharMaterial(materiais, '99999999-00'), []);
});
