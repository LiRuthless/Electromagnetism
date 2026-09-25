function B = em_touchField(I)
%EM_TOUCHFIELD 贴线处磁场幅值 T（式 6.3）：B = μ₀I/(2π·d_touch)，
% d_touch = 线半径 0.25mm + 电感半径 3mm = 3.25mm（式 6.2）。
% 默认 I=100mA 时 ≈ 6.154 μT。
MU0 = 4*pi*1e-7;
TOUCH_DIST = 0.00025 + 0.003;
if nargin < 1, I = 0.1; end
B = MU0*I/(2*pi*TOUCH_DIST);
end
