function [bx, by, bz] = em_infiniteWireB(px, pz, I)
%EM_INFINITEWIREB 无限长直导线解析解（数学模型.md §5.4 式 5.5，自检对照基准）。
% 导线沿 +y 轴、过原点，电流 +y。B = μ₀I/(2πρ)，ρ 为到导线的垂直距离。
MU0 = 4*pi*1e-7;
R_MIN = 1e-3;
if nargin < 3, I = 0.1; end
rho = max(hypot(px, pz), R_MIN);
rhatx = px/rho;
rhatz = pz/rho;
bmag = MU0*I/(2*pi*rho);
% B 方向 = d × r̂，d = (0,1,0) → (rhatz, 0, -rhatx)
bx = bmag * rhatz;
by = 0;
bz = bmag * (-rhatx);
end
