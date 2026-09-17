import re
p = "/.auscode/workspaces/TV3AHW/小说/chapters/第014章-暗殿的邀请函.md"
with open(p, 'r', encoding='utf-8') as f:
    t = f.read()
cn = re.findall(r'[\u4e00-\u9fff]', t)
print("CN:", len(cn))
# 中文字+常见标点
cn2 = re.findall(r'[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]', t)
print("CN+CNpunct:", len(cn2))
# 退化模式：破折号+引号+1-2字符+引号
bad = re.findall(r'——\s*["“][^"”]{1,2}["”]', t)
print("bad patterns:", len(bad))
for b in bad[:20]:
    print(" ", repr(b))
