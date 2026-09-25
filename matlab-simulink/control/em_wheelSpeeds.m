function [vL, vR] = em_wheelSpeeds(u, vBase, vMax, w)
%EM_WHEELSPEEDS 由 PD 输出 u 分配两轮轮速（数学模型.md §8.3 式 8.3–8.5）。
%   Δv_外 = 2|u|/(1+w)，Δv_内 = 2|u|·w/(1+w)，保持平均速度 ≈ v_base；
%   右转（u>0）：左外右内；左转反之。限幅 [0, vMax]。
a = abs(u);
dvOut = 2*a/(1+w);
dvIn  = 2*a*w/(1+w);
if u >= 0
    vL = vBase + dvOut;   % 右转：左轮为外轮
    vR = vBase - dvIn;    %       右轮为内轮
else
    vR = vBase + dvOut;   % 左转反之
    vL = vBase - dvIn;
end
vL = min(max(vL, 0), vMax);
vR = min(max(vR, 0), vMax);
end
