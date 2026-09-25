function v = em_motorLag(vAct, vCmd, alpha)
%EM_MOTORLAG 电机一阶滞后精确更新（数学模型.md §8.4 式 8.7）：
%   v(k+1) = v_cmd + (v(k) − v_cmd)·exp(−dt/τ)
% alpha = exp(−dt/τ) 由 init 预计算；τ=0 时 alpha=0，退化为瞬时跟随。
% 等价于传递函数 1/(τs+1) 在控制周期 dt 下的零阶保持精确离散化。
v = vCmd + (vAct - vCmd)*alpha;
end
