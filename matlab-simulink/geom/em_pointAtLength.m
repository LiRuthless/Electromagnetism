function [x, y, tx, ty] = em_pointAtLength(path, sTarget)
%EM_POINTATLENGTH 取弧长 s 处的点与单位切向（clamp 到端点，对应 pointAtLength()）。
n = numel(path.s);
if n == 0
    x = 0; y = 0; tx = 0; ty = 1;
    return
end
st = min(max(sTarget, 0), path.len);
i = 1;
while i + 1 <= n && path.s(i+1) < st
    i = i + 1;
end
x  = path.pts(i,1);
y  = path.pts(i,2);
tx = path.tang(i,1);
ty = path.tang(i,2);
end
