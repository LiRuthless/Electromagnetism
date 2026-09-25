function k = em_calibK(vppAnchor, I)
%EM_CALIBK 由贴线锚点反推标定系数 k（式 6.4）：k = Vpp_anchor / B_touch。
% 默认 Vpp_anchor=6V、I=100mA 时 k ≈ 9.75e5 V/T。电流变化时 k 不变。
if nargin < 1, vppAnchor = 6; end
if nargin < 2, I = 0.1; end
k = vppAnchor / em_touchField(I);
end
