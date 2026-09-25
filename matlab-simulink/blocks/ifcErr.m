function err = ifcErr(u)
%IFCERR 解释型 MATLAB Fcn 块包装：差比和差加权误差（式 8.1）。
% 输入 u = [L1;R1;L2;R2; errPrev]；系数 A/B/C/P 读 base 工作区 P。
% 非法结果（分母为零等）回退上一步误差 errPrev，避免 NaN 发散。
P = evalin('base','P');
err = (P.A*(u(1)-u(2)) + P.B*(u(3)-u(4))) / (P.A*(u(1)+u(2)) + P.C*abs(u(3)-u(4))) * P.Pcoef;
if ~isfinite(err)
    err = u(5);
end
end
