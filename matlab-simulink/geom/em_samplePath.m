function path = em_samplePath(segs, closed, ds)
%EM_SAMPLEPATH 主赛道中线采样（对应 samplePath()）：点列 + 单位切向 + 累计弧长。
%   ds 采样步进 m（默认 5 mm）。闭环赛道含吸合段，形成闭合回路。
if nargin < 3, ds = 0.005; end
[mids, dls] = em_buildElements(segs, closed, ds);
n = size(dls, 1);
pts  = zeros(n,2);
tang = zeros(n,2);
s    = zeros(n,1);
acc = 0;
for i = 1:n
    dlx = dls(i,1); dly = dls(i,2);
    L = hypot(dlx, dly);
    if L == 0, L = 1e-12; end
    pts(i,:)  = mids(i,1:2);
    tang(i,:) = [dlx/L, dly/L];
    s(i) = acc;
    acc = acc + L;
end
path = struct('pts',pts, 'tang',tang, 's',s, 'len',acc);
end
