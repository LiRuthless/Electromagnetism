function v = ifcLag(u)
%IFCLAG 解释型 MATLAB Fcn 块包装：电机一阶滞后精确更新（式 8.7）。
% 输入 u = [vCmd; vPrev]；输出 v = vCmd + (vPrev − vCmd)·alpha。
% alpha = exp(−dt/τ) 由 init 预计算到 TD.alpha（τ=0 时 0，瞬时跟随）。
TD = evalin('base','TD');
v = u(1) + (u(2) - u(1))*TD.alpha;
end
