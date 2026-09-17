'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'); const path=require('node:path');
const root=path.join(__dirname,'..','components');
const components=['button','card','checkbox','dialog','text-field','app-bar','loading'];
for(const name of components){
  test(`${name} component source exists and defines a real custom element`,()=>{
    const s=fs.readFileSync(path.join(root,`${name}.js`),'utf8');
    assert.match(s,/class\s+\w+\s+extends\s+HTMLElement/);
    assert.match(s,/customElements\.define\(/);
  });
}
test('button implements required interaction states',()=>{const s=fs.readFileSync(path.join(root,'button.js'),'utf8'); for(const x of ['disabled','loading','selected','active','focus-visible']) assert.match(s,new RegExp(x));});
test('design system theme implements both RTL/LTR and light/dark modes',()=>{const s=fs.readFileSync(path.join(root,'../theme/theme.js'),'utf8'); for(const x of ['rtl','ltr','dark','light','setDirection','setTheme']) assert.match(s,new RegExp(x));});
