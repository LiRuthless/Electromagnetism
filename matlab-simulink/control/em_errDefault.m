function err = em_errDefault(U, A, B, C, Pc)
%EM_ERRDEFAULT 差比和差加权误差（数学模型.md §8.2 式 8.1，默认公式）：
%   Err = [A·(L1−R1) + B·(L2−R2)] / [A·(L1+R1) + C·|L2−R2|] · P
% U = [L1; R1; L2; R2]（Vpp）。对应 TS DEFAULT_FORMULA 的固定结构版
% （Simulink 移植不含表达式文本解析器，结构固定、系数 A/B/C/P 可调）。
err = (A*(U(1)-U(2)) + B*(U(3)-U(4))) / (A*(U(1)+U(2)) + C*abs(U(3)-U(4))) * Pc;
end
