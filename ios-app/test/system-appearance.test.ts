import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url), {transformSync}=require('esbuild');

test('actual root follows phone appearance and DSH palette at the native window boundary',()=>{
  let theme={dark:true,bg:'#000000',ink:'#f5f5f7',accent:'#3964FE',line:'rgba(245,245,247,0.08)'};
  const backgrounds:string[]=[];
  const react={createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}}),useMemo:(factory:any)=>factory(),useLayoutEffect:(effect:any)=>effect()};
  const base={dark:false,colors:{background:'default background',card:'default card',text:'default text',primary:'default primary',border:'default border',notification:'notification'},fonts:{regular:{fontFamily:'System',fontWeight:'400'}}};
  const stack=Object.assign('Stack',{Screen:'Screen'});
  const mocks:Record<string,any>={
    'react':react,
    'react-native':{View:'View',Platform:{OS:'ios'}},
    'expo-router':{Stack:stack},
    'expo-router/react-navigation':{ThemeProvider:'ThemeProvider',DefaultTheme:base,DarkTheme:{...base,dark:true}},
    'expo-system-ui':{setBackgroundColorAsync:async(color:string)=>{backgrounds.push(color)}},
    'uniwind':{useCSSVariable:()=>theme.dark?'#171717':'#f6f6f8'},
    '@tanstack/react-query':{QueryClient:class{}},
    '../src/theme':{useTheme:()=>theme},
    '../src/i18n':{useI18n:()=>({tr:(text:string)=>text})},
    '../src/preview/preview-session':{designPreview:false},
  };
  const source=readFileSync(new URL('../app/_layout.tsx',import.meta.url),'utf8')+'\nexport { Root };';
  const code=transformSync(source,{loader:'tsx',format:'cjs',jsx:'transform'}).code;
  const module={exports:{} as any};
  new Function('require','module','exports','__DEV__',code)((name:string)=>mocks[name]??{},module,module.exports,false);
  for(const next of [theme,{...theme,dark:false,bg:'#ffffff',ink:'#141414'}, {...theme,bg:'#1f1e1b',accent:'#d97757'}]){
    theme=next;
    const tree=module.exports.Root();
    assert.equal(backgrounds.at(-1),theme.bg,'send the resolved palette to Expo’s native window/root API');
    assert.equal(tree.type,'ThemeProvider');
    assert.equal(tree.props.value.dark,theme.dark);
    assert.equal(tree.props.value.colors.card,theme.bg,'native headers and modal surfaces use the same palette');
    assert.equal(tree.props.value.colors.background,theme.bg);
    assert.equal(tree.props.value.colors.text,theme.ink);
    assert.equal(tree.props.value.colors.primary,theme.accent);
    assert.equal(tree.props.value.fonts,base.fonts,'retain navigation font definitions');
  }
  assert.deepEqual(backgrounds,['#000000','#ffffff','#1f1e1b']);
});
