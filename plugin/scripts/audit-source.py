"""Reject private runtime/signing files and obvious credentials without printing values."""
from pathlib import Path
import hashlib, re, subprocess, sys, tarfile
root=Path(__file__).resolve().parents[2]
rules={
 'private-key':re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
 'personal-path':re.compile(rb'/(?:Users|home)/[a-z][a-z0-9_-]+/|[a-z0-9-]+\.tail[a-z0-9]+\.ts\.net'),
 'credential':re.compile(rb'(?:gh[pousr]_[A-Za-z0-9]{24,}|sk-[A-Za-z0-9_-]{24,})'),
 'credential-url':re.compile(rb'https?://[^\s"\x27<>]+[?&](?:token|api_key|access_token)=[A-Za-z0-9._~-]{16,}'),
}
# Upstream DS Bot tests that deliberately contain look-alike values: a fake GitHub
# token for the key detector and the generic /home/user path for home-folder
# redaction. Each is accepted only for its rule and its exact reviewed content;
# any edit to the file is audited again.
reviewed={
 # OpenBot fixed upstream test: repeated synthetic body and partial PEM marker assertions.
 ('ios-app/openbot/packages/logging/src/redaction.test.ts','private-key'):'19569c4f750022c9393345227ba848ff03d77e15e7105bdbe98c972c96c9a15e',
 ('plugin/engine/test/diagnostics.test.js','personal-path'):'53572bbb6666b62b93add1e2f5c66ac34844ce60699b5e698a0a7f38df8e206f',
 ('plugin/engine/test/memory.test.js','credential'):'0a2285a16bea8e8359cfbcc3cb1104551f6b622c2a181e19572abd1fdab06290',
 ('plugin/engine/test/update.test.js','personal-path'):'0fe8d6ae0de1e51a9ad2e717a2d14801791828dbe26a6c84c2076c0689d640a1',
}
findings=[]; count=0
def check(name,data):
 global count
 count+=1
 parts=Path(name).parts
 if any(p in ('node_modules','signing','fixture','profiles','sessions','.state','DerivedData') or p.startswith('.dsh-test') for p in parts) or Path(name).suffix in ('.p12','.p8','.pem','.key','.mobileprovision','.ipa'):findings.append((name,'private-runtime-file'))
 for label,pattern in rules.items():
  if pattern.search(data) and reviewed.get((name,label))!=hashlib.sha256(data).hexdigest():findings.append((name,label))
for raw in subprocess.check_output(['git','ls-files','-z'],cwd=root).split(b'\0'):
 if raw:
  name=raw.decode();p=root/name
  if p.is_symlink():findings.append((name,'symlink'))
  elif p.is_file():check(name,p.read_bytes())
for path in (root/'artifacts').glob('*.tgz'):
 with tarfile.open(path) as archive:
  for member in archive.getmembers():
   if not member.isfile() or member.name.startswith('/') or '..' in Path(member.name).parts:findings.append((path.name,'unsafe-member'));continue
   check(path.name+'/'+member.name,archive.extractfile(member).read())
for name,rule in findings:print(rule+': '+name)
print(f'Audited {count} source/package records; {len(findings)} findings')
sys.exit(bool(findings))
