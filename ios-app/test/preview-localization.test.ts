import test from 'node:test';import assert from 'node:assert/strict';import {buildSync} from 'esbuild';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
import {PreviewError} from '../src/ds/attachment-preview.ts';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
test('the actual mobile sourceText path translates safe preview errors, including native decode failures',()=>{
 const result=buildSync({absWorkingDir:root,entryPoints:['openbot/mobile/src/shared/lib/text-value.ts'],bundle:true,write:false,platform:'node',format:'cjs',logLevel:'silent'}),module={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
 const zh=module.exports.textFor('zh'),en=module.exports.textFor('en');
 for(const reason of ['scope','auth','network','mime','size','empty','encoding','format','dimensions','busy','unavailable','decode'] as const){const error=new PreviewError(reason);assert.equal(en.sourceText(error.message),error.message);assert.notEqual(zh.sourceText(error.message),error.message,reason);assert.match(zh.sourceText(error.message),/[\u4e00-\u9fff]/u);}
 assert.equal(zh.sourceText(new PreviewError('decode').message),'此设备无法打开图片预览，请重试。');
});
