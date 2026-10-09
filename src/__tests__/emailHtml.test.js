const { escapeHtml } = require('../utils/html');
const { loadTemplate } = require('../utils/emailTemplates');

describe('E-mails : aucune saisie utilisateur interprétée comme du HTML', () => {
  test('escapeHtml échappe les 5 caractères spéciaux', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });

  test('template : un commentaire piégé reste du texte', () => {
    const html = loadTemplate('ratingReceivedEmail', {
      userName: 'Awa',
      comment: '<a href="https://phishing.example">Cliquez ici</a>',
    });

    expect(html).not.toContain('<a href="https://phishing.example">');
    expect(html).toContain('&lt;a href=&quot;https://phishing.example&quot;&gt;');
  });

  test('template : les motifs spéciaux de replace ($&) ne sont pas interprétés', () => {
    const html = loadTemplate('ratingReceivedEmail', { userName: '$&$`' });

    expect(html).toContain('Bonjour $&amp;$`');
  });

  test('template : une variable non fournie disparaît', () => {
    expect(loadTemplate('ratingReceivedEmail', {})).not.toMatch(/{{\w+}}/);
  });
});
